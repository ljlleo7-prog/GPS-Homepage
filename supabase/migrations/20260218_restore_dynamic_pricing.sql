CREATE OR REPLACE FUNCTION public.compute_noise_step(p_ticket_type_id UUID, p_noise NUMERIC, p_hour TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_noise_pct NUMERIC;
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
  v_theta NUMERIC;
  v_sigma NUMERIC;
  v_eps DOUBLE PRECISION;
  v_bytes BYTEA;
  v_u1 DOUBLE PRECISION;
  v_u2 DOUBLE PRECISION;
  v_u3 DOUBLE PRECISION;
  v_distance NUMERIC;
  v_sigma_floor NUMERIC;
  v_tscale NUMERIC;
  v_step NUMERIC;
  v_noise NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  LEFT JOIN public.ticket_types t ON t.instrument_id = i.id
  WHERE t.id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN p_noise;
  END IF;
  v_noise_pct := COALESCE(v_instr.dynamic_noise_pct, 0) / 100.0;
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, COALESCE(v_instr.dynamic_flex_pct, 0));
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 500);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (p_hour - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(1, v_elapsed / v_total_interval)) END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  IF v_limit IS NULL OR v_limit = 0 OR v_limit >= v_sat * 10 THEN
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_sat::NUMERIC)));
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_tscale := (0.5 * v_time_factor + 0.5 * v_demand_factor);
  v_theta := 0.05 + 0.15 * v_tscale;
  v_distance := GREATEST(0, LEAST(1, abs(p_noise) / NULLIF(v_noise_pct,0)));
  v_sigma := v_noise_pct * (0.6 + 0.4 * (1 - v_tscale)) * (0.7 + 0.3 * (1 - v_distance));
  v_sigma_floor := v_noise_pct * 0.15;
  IF v_sigma < v_sigma_floor THEN
    v_sigma := v_sigma_floor;
  END IF;
  v_bytes := decode(md5(p_ticket_type_id::text || to_char(p_hour, 'YYYYMMDDHH24')), 'hex');
  v_u1 := get_byte(v_bytes, 0) / 255.0;
  v_u2 := get_byte(v_bytes, 1) / 255.0;
  v_u3 := get_byte(v_bytes, 2) / 255.0;
  v_eps := (v_u1 + v_u2 + v_u3 - 1.5) * 2.0;
  v_step := -v_theta * p_noise + v_sigma * v_eps::NUMERIC
            + (CASE WHEN p_noise >= 0 THEN -1 ELSE 1 END) * (v_sigma * 0.10 * v_distance);
  v_noise := p_noise + v_step;
  v_noise := GREATEST(-v_noise_pct, LEAST(v_noise_pct, v_noise));
  RETURN v_noise;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ticket_noise(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hour TIMESTAMPTZ := date_trunc('hour', p_at);
  v_state RECORD;
  v_next NUMERIC;
BEGIN
  SELECT noise, last_hour INTO v_state
  FROM public.price_noise_state
  WHERE ticket_type_id = p_ticket_type_id;
  IF NOT FOUND OR v_state.last_hour < v_hour THEN
    v_next := public.compute_noise_step(p_ticket_type_id, COALESCE(v_state.noise, 0), v_hour);
    INSERT INTO public.price_noise_state (ticket_type_id, noise, last_hour, updated_at)
    VALUES (p_ticket_type_id, v_next, v_hour, NOW())
    ON CONFLICT (ticket_type_id)
    DO UPDATE SET noise = EXCLUDED.noise, last_hour = EXCLUDED.last_hour, updated_at = NOW();
    RETURN v_next;
  END IF;
  RETURN v_state.noise;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type_at(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_sat INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_progress NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_demand_factor NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
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
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, COALESCE(v_instr.dynamic_flex_pct, 0));
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 500);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (p_at - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(1, v_elapsed / v_total_interval)) END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  v_demand_ratio := (v_total_sold::NUMERIC / v_sat::NUMERIC);
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_noise := public.get_ticket_noise(p_ticket_type_id, p_at);
  v_price := v_base * (1 + v_flex_d * v_demand_factor + v_flex_t * v_time_factor) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_sat INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_progress NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_demand_factor NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
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
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, COALESCE(v_instr.dynamic_flex_pct, 0));
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 500);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (NOW() - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(1, v_elapsed / v_total_interval)) END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  v_demand_ratio := (v_total_sold::NUMERIC / v_sat::NUMERIC);
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_noise := public.get_ticket_noise(p_ticket_type_id, NOW());
  v_price := v_base * (1 + v_flex_d * v_demand_factor + v_flex_t * v_time_factor) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_official_price_for_purchase(p_ticket_type_id UUID, p_quantity INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_sat INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_progress NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_demand_factor NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
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
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, COALESCE(v_instr.dynamic_flex_pct, 0));
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 500);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (NOW() - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(1, v_elapsed / v_total_interval)) END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  v_demand_ratio := ((v_total_sold + GREATEST(p_quantity, 0))::NUMERIC / v_sat::NUMERIC);
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_noise := public.get_ticket_noise(p_ticket_type_id, NOW());
  v_price := v_base * (1 + v_flex_d * v_demand_factor + v_flex_t * v_time_factor) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;
