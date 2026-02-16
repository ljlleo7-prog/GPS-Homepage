-- Make compute_noise_step robust against missing newer columns by reading via to_jsonb

CREATE OR REPLACE FUNCTION public.compute_noise_step(p_ticket_type_id UUID, p_noise NUMERIC, p_hour TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instr_json JSONB;
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
  v_p_bias NUMERIC;
  v_seed DOUBLE PRECISION;
  v_eps DOUBLE PRECISION;
  v_step NUMERIC;
  v_noise NUMERIC;
BEGIN
  SELECT to_jsonb(i) INTO v_instr_json
  FROM public.support_instruments i
  WHERE i.ticket_type_id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF v_instr_json IS NULL THEN
    RETURN p_noise;
  END IF;
  v_noise_pct := COALESCE((v_instr_json->>'dynamic_noise_pct')::NUMERIC, 0) / 100.0;
  v_flex_d := COALESCE((v_instr_json->>'dynamic_flex_demand_pct')::NUMERIC, (v_instr_json->>'dynamic_flex_pct')::NUMERIC, 0);
  v_flex_t := COALESCE((v_instr_json->>'dynamic_flex_time_pct')::NUMERIC, 0);
  v_sat := COALESCE((v_instr_json->>'demand_saturation_units')::INTEGER, 500);
  v_limit := COALESCE((v_instr_json->>'ticket_limit')::INTEGER, 0);
  v_open := COALESCE((v_instr_json->>'open_date')::TIMESTAMPTZ, (v_instr_json->>'created_at')::TIMESTAMPTZ);
  v_end := CASE WHEN COALESCE((v_instr_json->>'is_driver_bet')::BOOLEAN, false)
                THEN COALESCE((v_instr_json->>'open_date')::TIMESTAMPTZ, (v_instr_json->>'official_end_date')::TIMESTAMPTZ, v_open)
                ELSE COALESCE((v_instr_json->>'official_end_date')::TIMESTAMPTZ, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE EXTRACT(EPOCH FROM (p_hour - v_open)) END;
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  v_demand_ratio := (v_total_sold::NUMERIC / v_sat::NUMERIC);
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_theta := 0.1 + 0.3 * (0.5 * v_time_factor + 0.5 * v_demand_factor);
  v_sigma := v_noise_pct * (0.5 + 0.5 * (1 - (0.5 * v_time_factor + 0.5 * v_demand_factor)));
  v_p_bias := LEAST(1, GREATEST(0, 0.55 + 0.4 * (0.5 * v_time_factor + 0.5 * v_demand_factor)));
  v_seed := ((EXTRACT(EPOCH FROM p_hour) / 3600.0) + ascii(substr(p_ticket_type_id::text, 1, 1)) * 0.01);
  PERFORM setseed((v_seed - floor(v_seed))::double precision);
  v_eps := (random() + random() + random() - 1.5) * 2.0;
  v_step := v_theta * (0 - p_noise) + v_sigma * v_eps;
  IF random() < v_p_bias THEN
    v_step := v_step + v_sigma * abs(v_eps) * CASE WHEN p_noise > 0 THEN -1 ELSE 1 END;
  END IF;
  v_noise := p_noise + v_step;
  v_noise := GREATEST(-v_noise_pct, LEAST(v_noise_pct, v_noise));
  RETURN v_noise;
END;
$$;
