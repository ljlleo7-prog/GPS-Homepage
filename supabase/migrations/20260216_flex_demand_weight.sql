ALTER TABLE public.support_instruments ADD COLUMN IF NOT EXISTS dynamic_flex_demand_pct NUMERIC;
ALTER TABLE public.support_instruments ADD COLUMN IF NOT EXISTS dynamic_flex_time_pct NUMERIC;
ALTER TABLE public.support_instruments ADD COLUMN IF NOT EXISTS demand_saturation_units INTEGER;

UPDATE public.support_instruments
SET dynamic_flex_demand_pct = COALESCE(dynamic_flex_pct, 0),
    dynamic_flex_time_pct = 0,
    demand_saturation_units = COALESCE(demand_saturation_units, 100)
WHERE dynamic_flex_demand_pct IS NULL OR dynamic_flex_time_pct IS NULL OR demand_saturation_units IS NULL;

CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type_at(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_limit INTEGER;
  v_sat INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  WHERE i.ticket_type_id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_base := COALESCE(v_instr.ticket_price, 1.0);
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, COALESCE(v_instr.dynamic_flex_pct, 0));
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 100);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(v_total_interval, EXTRACT(EPOCH FROM (p_at - v_open)))) END;
  v_time_factor := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  IF v_limit IS NULL OR v_limit = 0 OR v_limit >= v_sat * 10 THEN
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_sat::NUMERIC)));
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_noise := public.get_ticket_noise(p_ticket_type_id, p_at);
  v_price := v_base * (1 + v_flex_d * v_demand_ratio + v_flex_t * v_time_factor) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_limit INTEGER;
  v_sat INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  WHERE i.ticket_type_id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_base := COALESCE(v_instr.ticket_price, 1.0);
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, COALESCE(v_instr.dynamic_flex_pct, 0));
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 100);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(v_total_interval, EXTRACT(EPOCH FROM (NOW() - v_open)))) END;
  v_time_factor := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  IF v_limit IS NULL OR v_limit = 0 OR v_limit >= v_sat * 10 THEN
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_sat::NUMERIC)));
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_noise := public.get_ticket_noise(p_ticket_type_id, NOW());
  v_price := v_base * (1 + v_flex_d * v_demand_ratio + v_flex_t * v_time_factor) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_official_price_for_purchase(p_ticket_type_id UUID, p_quantity INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex_d NUMERIC;
  v_flex_t NUMERIC;
  v_limit INTEGER;
  v_sat INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_noise NUMERIC;
  v_price NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  WHERE i.ticket_type_id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_base := COALESCE(v_instr.ticket_price, 1.0);
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, COALESCE(v_instr.dynamic_flex_pct, 0));
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 100);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(v_total_interval, EXTRACT(EPOCH FROM (NOW() - v_open)))) END;
  v_time_factor := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  IF v_limit IS NULL OR v_limit = 0 OR v_limit >= v_sat * 10 THEN
    v_demand_ratio := GREATEST(0, LEAST(1, ((v_total_sold + GREATEST(p_quantity, 0))::NUMERIC / v_sat::NUMERIC)));
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, ((v_total_sold + GREATEST(p_quantity, 0))::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_noise := public.get_ticket_noise(p_ticket_type_id, NOW());
  v_price := v_base * (1 + v_flex_d * v_demand_ratio + v_flex_t * v_time_factor) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;
