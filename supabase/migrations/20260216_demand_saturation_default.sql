-- Demand saturation default/backfill and driver bet creation default

ALTER TABLE public.support_instruments 
  ALTER COLUMN demand_saturation_units SET DEFAULT 500;

UPDATE public.support_instruments
SET demand_saturation_units = 500
WHERE demand_saturation_units IS NULL OR demand_saturation_units <= 0;

-- Update price functions to coalesce to 500 and keep SECURITY DEFINER
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
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
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
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
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
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
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

-- Update create_driver_bet to accept optional demand_saturation_units with default 500
CREATE OR REPLACE FUNCTION public.create_driver_bet(
  p_title TEXT,
  p_description TEXT,
  p_side_a_name TEXT,
  p_ticket_price NUMERIC,
  p_ticket_limit INTEGER,
  p_official_end_date TIMESTAMPTZ,
  p_open_date TIMESTAMPTZ,
  p_side_b_name TEXT DEFAULT NULL,
  p_noise_pct NUMERIC DEFAULT 0,
  p_flex_pct NUMERIC DEFAULT 0,
  p_demand_saturation_units INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_instrument_id UUID;
  v_ticket_a_id UUID;
  v_ticket_b_id UUID;
  v_side_a_full TEXT;
  v_side_b_full TEXT;
BEGIN
  IF (SELECT reputation_balance FROM public.wallets WHERE user_id = v_user_id) <= 50 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Reputation too low (< 50)');
  END IF;
  IF p_ticket_price < 0.1 OR p_ticket_price > 100 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ticket price must be between 0.1 and 100');
  END IF;
  IF p_side_b_name IS NOT NULL AND p_side_b_name != '' THEN
    v_side_a_full := p_side_a_name;
    v_side_b_full := p_side_b_name;
  ELSE
    v_side_a_full := p_side_a_name || ' will happen';
    v_side_b_full := p_side_a_name || ' will not happen';
  END IF;
  INSERT INTO public.support_instruments (
    creator_id, title, description, type, status, risk_level,
    is_driver_bet, side_a_name, side_b_name,
    ticket_price, ticket_limit, official_end_date, open_date,
    resolution_status, dynamic_noise_pct, dynamic_flex_pct,
    demand_saturation_units
  ) VALUES (
    v_user_id, p_title, p_description, 'MARKET', 'OPEN', 'HIGH',
    true, v_side_a_full, v_side_b_full,
    p_ticket_price, p_ticket_limit, p_official_end_date, p_open_date,
    'OPEN', COALESCE(p_noise_pct, 0), COALESCE(p_flex_pct, 0),
    COALESCE(p_demand_saturation_units, 500)
  ) RETURNING id INTO v_instrument_id;
  INSERT INTO public.ticket_types (creator_id, title, description, total_supply)
  VALUES (v_user_id, p_title || ' (' || v_side_a_full || ')', 'Bet: ' || v_side_a_full, p_ticket_limit)
  RETURNING id INTO v_ticket_a_id;
  INSERT INTO public.ticket_types (creator_id, title, description, total_supply)
  VALUES (v_user_id, p_title || ' (' || v_side_b_full || ')', 'Bet: ' || v_side_b_full, p_ticket_limit)
  RETURNING id INTO v_ticket_b_id;
  UPDATE public.support_instruments
  SET ticket_type_a_id = v_ticket_a_id, ticket_type_b_id = v_ticket_b_id
  WHERE id = v_instrument_id;
  RETURN jsonb_build_object('success', true, 'message', 'Driver Bet created successfully', 'id', v_instrument_id);
END;
$$;
