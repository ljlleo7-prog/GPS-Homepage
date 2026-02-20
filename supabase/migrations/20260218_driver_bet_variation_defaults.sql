DO $$
BEGIN
  UPDATE public.support_instruments
  SET dynamic_noise_pct = 1
  WHERE COALESCE(is_driver_bet, false) = true
    AND COALESCE(dynamic_noise_pct, 0) <= 0;

  UPDATE public.support_instruments
  SET dynamic_flex_time_pct = 0
  WHERE COALESCE(is_driver_bet, false) = true
    AND COALESCE(dynamic_flex_time_pct, 0) <> 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.create_driver_bet(
  p_title TEXT,
  p_description TEXT,
  p_side_a_name TEXT,
  p_ticket_price NUMERIC,
  p_ticket_limit INTEGER,
  p_official_end_date TIMESTAMPTZ,
  p_open_date TIMESTAMPTZ,
  p_side_b_name TEXT DEFAULT NULL,
  p_noise_pct NUMERIC DEFAULT 1,
  p_flex_pct NUMERIC DEFAULT 0.15,
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
  v_noise NUMERIC := COALESCE(p_noise_pct, 1);
  v_flex_d NUMERIC := COALESCE(p_flex_pct, 0.15);
  v_flex_t NUMERIC := 0;
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
  v_noise := LEAST(v_noise, 50.0);
  v_flex_d := LEAST(v_flex_d, 0.5);
  v_flex_t := LEAST(v_flex_t, 0.5);
  INSERT INTO public.support_instruments (
    creator_id, title, description, type, status, risk_level,
    is_driver_bet, side_a_name, side_b_name,
    ticket_price, ticket_limit, official_end_date, open_date,
    resolution_status, dynamic_noise_pct, dynamic_flex_demand_pct,
    demand_saturation_units, dynamic_flex_time_pct
  ) VALUES (
    v_user_id, p_title, p_description, 'MARKET', 'OPEN', 'HIGH',
    true, v_side_a_full, v_side_b_full,
    p_ticket_price, p_ticket_limit, p_official_end_date, p_open_date,
    'OPEN', v_noise, v_flex_d,
    COALESCE(p_demand_saturation_units, 500), v_flex_t
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
