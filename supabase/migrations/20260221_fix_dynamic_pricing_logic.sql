
-- Fix dynamic pricing logic: Price = Base * (1 + Noise), where Noise follows a random walk towards Flex Target
-- This replaces the previous logic where Price = Base * (1 + Flex) * (1 + Noise)

-- 1. Helper to calculate the target flex factor (Demand + Time)
CREATE OR REPLACE FUNCTION public.calculate_flex_factor(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_sat INTEGER;
  v_limit INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_progress NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_demand_factor NUMERIC;
BEGIN
  -- Fetch instrument details
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  LEFT JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, 0);
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 100);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;

  -- Time Factor Calculation
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (p_at - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(1, v_elapsed / v_total_interval)) END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;

  -- Demand Factor Calculation
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;

  IF v_limit IS NULL OR v_limit = 0 OR v_limit >= v_sat * 10 THEN
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_sat::NUMERIC)));
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_demand_factor := power(v_demand_ratio, 0.7);

  -- Total Target Flex
  RETURN (v_flex_d * v_demand_factor) + (v_flex_t * v_time_factor);
END;
$$;

-- 2. Update compute_noise_step to take target noise (flex) and limit step size
-- New signature: p_target_noise added
CREATE OR REPLACE FUNCTION public.compute_noise_step(
  p_ticket_type_id UUID, 
  p_current_noise NUMERIC, 
  p_target_noise NUMERIC,
  p_hour TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_instr RECORD;
  v_noise_pct NUMERIC;
  v_step_limit NUMERIC;
  v_delta NUMERIC;
  v_bias NUMERIC;
  v_random NUMERIC;
  v_step NUMERIC;
  v_bytes BYTEA;
  v_u1 NUMERIC;
BEGIN
  SELECT dynamic_noise_pct INTO v_instr
  FROM public.support_instruments i
  JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
  UNION ALL
  SELECT dynamic_noise_pct
  FROM public.support_instruments
  WHERE ticket_type_a_id = p_ticket_type_id OR ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  
  -- Default noise limit (e.g. 1% -> 0.01)
  -- The stored value is percentage, so 1 means 1%, i.e. 0.01 factor?
  -- Wait, previous code used: v_noise_pct := COALESCE(v_instr.dynamic_noise_pct, 1) / 100.0;
  v_noise_pct := COALESCE(v_instr.dynamic_noise_pct, 1) / 100.0;
  
  -- Step limit is the max change per hour (e.g. 1%)
  v_step_limit := v_noise_pct;
  
  v_delta := p_target_noise - p_current_noise;
  
  -- Bias: Move towards target. Max bias is half the step limit.
  -- If delta is small, bias is small.
  v_bias := SIGN(v_delta) * LEAST(ABS(v_delta), v_step_limit * 0.5);
  
  -- Random Component: Deterministic for the hour using hash
  -- Range: [-0.5 * step_limit, 0.5 * step_limit]
  v_bytes := decode(md5(p_ticket_type_id::text || to_char(p_hour, 'YYYYMMDDHH24')), 'hex');
  v_u1 := (get_byte(v_bytes, 0) / 255.0); -- 0 to 1
  v_random := (v_u1 - 0.5) * v_step_limit; -- -0.5*limit to +0.5*limit
  
  -- Total Step
  v_step := v_bias + v_random;
  
  -- Clamp step to absolute limit
  v_step := GREATEST(-v_step_limit, LEAST(v_step_limit, v_step));
  
  RETURN p_current_noise + v_step;
END;
$$;

-- 3. Update get_ticket_noise to use the new compute_noise_step logic
CREATE OR REPLACE FUNCTION public.get_ticket_noise(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hour TIMESTAMPTZ := date_trunc('hour', p_at);
  v_state RECORD;
  v_next NUMERIC;
  v_target NUMERIC;
BEGIN
  SELECT noise, last_hour INTO v_state
  FROM public.price_noise_state
  WHERE ticket_type_id = p_ticket_type_id;

  -- If state is missing or old, update it
  IF NOT FOUND OR v_state.last_hour < v_hour THEN
    -- Calculate target flex for the *current* hour (or previous if catching up?)
    -- Ideally we want the target based on current conditions to guide the step.
    v_target := public.calculate_flex_factor(p_ticket_type_id, v_hour);
    
    -- Compute next noise step
    v_next := public.compute_noise_step(p_ticket_type_id, COALESCE(v_state.noise, 0), v_target, v_hour);
    
    -- Update state
    INSERT INTO public.price_noise_state (ticket_type_id, noise, last_hour, updated_at)
    VALUES (p_ticket_type_id, v_next, v_hour, NOW())
    ON CONFLICT (ticket_type_id)
    DO UPDATE SET noise = EXCLUDED.noise, last_hour = EXCLUDED.last_hour, updated_at = NOW();
    
    RETURN v_next;
  END IF;
  
  RETURN v_state.noise;
END;
$$;

-- 4. Update get_official_price_by_ticket_type_at to rely on Base * (1 + Noise)
CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type_at(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  -- Fetch instrument details just for Base Price
  SELECT i.ticket_price, i.ticket_limit, i.demand_saturation_units INTO v_instr
  FROM public.support_instruments i
  LEFT JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_base := COALESCE(v_instr.ticket_price, 1.0);
  
  -- Get Noise (which now incorporates Flex target logic)
  v_noise := public.get_ticket_noise(p_ticket_type_id, p_at);
  
  -- Price Formula: Base * (1 + Noise)
  -- Note: Flex is already the target for Noise, so Noise will eventually reach Flex.
  v_price := v_base * (1 + v_noise);
  
  -- Safety floor
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  
  RETURN v_price;
END;
$$;
