
-- Update Dynamic Pricing: Stateful Price with Random Walk
-- Official Price = Last Official Price * (1 + Noise Step)
-- Noise Step is biased towards Target Price (Base * (1 + Flex))

-- 1. Add current_price to price_noise_state
ALTER TABLE public.price_noise_state 
ADD COLUMN IF NOT EXISTS current_price NUMERIC;

-- 2. New Function: compute_next_price_step
-- Calculates the next price given current price and target price
CREATE OR REPLACE FUNCTION public.compute_next_price_step(
  p_ticket_type_id UUID, 
  p_current_price NUMERIC, 
  p_target_price NUMERIC,
  p_hour TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_instr RECORD;
  v_noise_pct NUMERIC;
  v_step_limit NUMERIC;
  v_delta_pct NUMERIC;
  v_bias NUMERIC;
  v_random NUMERIC;
  v_step NUMERIC;
  v_bytes BYTEA;
  v_u1 NUMERIC;
  v_r NUMERIC;
  v_k NUMERIC := 1.0;
  v_alpha NUMERIC := 0.5;
  v_w NUMERIC;
  v_noise_base_frac NUMERIC := 0.6;
  v_noise_mul NUMERIC;
  v_step_to_target NUMERIC;
BEGIN
  -- Get instrument config
  SELECT dynamic_noise_pct INTO v_instr
  FROM public.support_instruments i
  JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
  UNION ALL
  SELECT dynamic_noise_pct
  FROM public.support_instruments
  WHERE ticket_type_a_id = p_ticket_type_id OR ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  
  -- Default limit (e.g. 1% -> 0.01)
  v_noise_pct := COALESCE(v_instr.dynamic_noise_pct, 1) / 100.0;
  v_step_limit := v_noise_pct;
  
  -- Calculate percentage difference to target
  -- If current=100, target=110, delta=+10, delta_pct=0.1
  IF p_current_price = 0 THEN RETURN 0; END IF;
  
  v_delta_pct := (p_target_price - p_current_price) / p_current_price;
  
  v_r := ABS(v_delta_pct) / GREATEST(v_step_limit, 1e-6);
  -- Concave, sublinear bias weight: w = ( (k * r)^alpha ) / (1 + (k * r)^alpha )
  v_w := (POWER(v_k * v_r, v_alpha)) / (1 + POWER(v_k * v_r, v_alpha));
  -- Constant step cap (no amplification)
  v_step_to_target := SIGN(v_delta_pct) * LEAST(ABS(v_delta_pct), v_step_limit);
  v_bias := v_step_to_target * v_w;
  
  -- Random Component: Deterministic for the hour using hash
  v_bytes := decode(md5(p_ticket_type_id::text || to_char(p_hour, 'YYYYMMDDHH24')), 'hex');
  v_u1 := (get_byte(v_bytes, 0) / 255.0); -- 0 to 1
  -- Noise with floor so probability ramps smoothly (never vanishes)
  v_noise_mul := v_noise_base_frac + (1 - v_noise_base_frac) * (1 - v_w); -- in [v_noise_base_frac, 1]
  v_random := ((v_u1 * 2) - 1) * v_step_limit * v_noise_mul; 
  
  -- Compose step (no (1-w) scaling on noise)
  v_step := v_bias + v_random;
  
  v_step := GREATEST(-v_step_limit, LEAST(v_step_limit, v_step));
  
  -- Return new price
  RETURN p_current_price * (1 + v_step);
END;
$$;

-- 3. Update get_official_price_by_ticket_type_at to update state iteratively
CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type_at(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_state RECORD;
  v_current_price NUMERIC;
  v_target_flex NUMERIC;
  v_target_price NUMERIC;
  v_hour TIMESTAMPTZ := date_trunc('hour', p_at);
  v_iter_hour TIMESTAMPTZ;
  v_loop_count INTEGER := 0;
BEGIN
  -- Fetch instrument details for Base Price
  SELECT i.ticket_price INTO v_instr
  FROM public.support_instruments i
  LEFT JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  v_base := COALESCE(v_instr.ticket_price, 1.0);

  -- Get current state
  SELECT * INTO v_state
  FROM public.price_noise_state
  WHERE ticket_type_id = p_ticket_type_id;

  -- Initialize if missing
  IF NOT FOUND THEN
    v_current_price := v_base;
    INSERT INTO public.price_noise_state (ticket_type_id, current_price, last_hour, updated_at)
    VALUES (p_ticket_type_id, v_base, v_hour - INTERVAL '1 hour', NOW());
    v_iter_hour := v_hour - INTERVAL '1 hour';
  ELSE
    -- Use stored price, or fallback to base if NULL (migration case)
    v_current_price := COALESCE(v_state.current_price, v_base);
    v_iter_hour := v_state.last_hour;
  END IF;

  -- Catch-up Logic:
  -- If gap is huge (> 24 hours), jump ahead to 24 hours ago.
  -- This assumes price was "frozen" during inactivity.
  IF v_hour - v_iter_hour > INTERVAL '24 hours' THEN
    v_iter_hour := v_hour - INTERVAL '24 hours';
  END IF;

  -- Iterative Update Loop (Simulate hourly steps)
  IF v_iter_hour < v_hour THEN
    WHILE v_iter_hour < v_hour LOOP
      v_iter_hour := v_iter_hour + INTERVAL '1 hour';
      
      -- Calculate Target Price for this hour (Base * (1 + Flex))
      v_target_flex := public.calculate_flex_factor(p_ticket_type_id, v_iter_hour);
      v_target_price := v_base * (1 + v_target_flex);
      
      -- Calculate Next Price Step
      v_current_price := public.compute_next_price_step(p_ticket_type_id, v_current_price, v_target_price, v_iter_hour);
    END LOOP;

    -- Update state
    UPDATE public.price_noise_state
    SET current_price = v_current_price,
        last_hour = v_iter_hour,
        updated_at = NOW()
    WHERE ticket_type_id = p_ticket_type_id;
  END IF;
  
  -- Safety floor
  IF v_current_price < 0.1 THEN v_current_price := 0.1; END IF;
  
  RETURN v_current_price;
END;
$$;

-- 4. Helper wrappers to ensure consistent pricing logic

-- get_official_price_by_ticket_type (calls _at(NOW()))
CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.get_official_price_by_ticket_type_at(p_ticket_type_id, NOW());
END;
$$;

-- get_official_price_for_purchase (quantity * price)
CREATE OR REPLACE FUNCTION public.get_official_price_for_purchase(p_ticket_type_id UUID, p_quantity INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_price NUMERIC;
BEGIN
  v_price := public.get_official_price_by_ticket_type_at(p_ticket_type_id, NOW());
  IF v_price IS NULL THEN RETURN NULL; END IF;
  RETURN v_price * p_quantity;
END;
$$;

-- get_ticket_noise (legacy compatibility: derive noise from current_price)
-- Noise = (CurrentPrice - BasePrice) / BasePrice
CREATE OR REPLACE FUNCTION public.get_ticket_noise(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_current NUMERIC;
BEGIN
  -- Get base price
  SELECT i.ticket_price INTO v_instr
  FROM public.support_instruments i
  LEFT JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;

  IF NOT FOUND THEN RETURN 0; END IF;
  v_base := COALESCE(v_instr.ticket_price, 1.0);
  if v_base = 0 THEN RETURN 0; END IF;

  -- Get current price (will trigger update if needed)
  v_current := public.get_official_price_by_ticket_type_at(p_ticket_type_id, p_at);
  
  RETURN (v_current - v_base) / v_base;
END;
$$;
