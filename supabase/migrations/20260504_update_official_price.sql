-- Update get_official_price to include acceptance modifier
CREATE OR REPLACE FUNCTION public.get_official_price(p_instrument_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex NUMERIC;
  v_noise_pct NUMERIC;
  v_total_sold INTEGER;
  v_limit INTEGER;
  v_group_total_sold INTEGER;
  v_group_limit INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_factor NUMERIC;
  v_demand_ratio NUMERIC;
  v_adjust NUMERIC;
  v_price NUMERIC;
  v_acceptance_modifier NUMERIC;
BEGIN
  SELECT * INTO v_instr FROM public.support_instruments WHERE id = p_instrument_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_base := COALESCE(v_instr.ticket_price, 1.0);
  v_flex := COALESCE(v_instr.dynamic_flex_pct, 0);
  v_noise_pct := 0;
  v_limit := COALESCE(v_instr.ticket_limit, 0);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := COALESCE(v_instr.official_end_date, v_open);

  IF v_end <= v_open THEN
    v_total_interval := 1;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;

  v_elapsed := GREATEST(0, LEAST(v_total_interval, EXTRACT(EPOCH FROM (NOW() - v_open))));
  v_time_factor := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;

  IF COALESCE(v_instr.is_driver_bet, false) THEN
    SELECT COALESCE(SUM(b.balance), 0) INTO v_group_total_sold
    FROM public.support_instruments i
    LEFT JOIN public.user_ticket_balances b ON b.ticket_type_id IN (i.ticket_type_a_id, i.ticket_type_b_id)
    WHERE i.is_driver_bet = true AND i.title = v_instr.title;
    v_total_sold := COALESCE(v_group_total_sold, 0);

    SELECT COALESCE(SUM(COALESCE(i.ticket_limit, 0)), 0) INTO v_group_limit
    FROM public.support_instruments i
    WHERE i.is_driver_bet = true AND i.title = v_instr.title;
    v_limit := COALESCE(v_group_limit, v_limit);
  ELSE
    SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
    FROM public.user_ticket_balances
    WHERE ticket_type_id = v_instr.ticket_type_id;
  END IF;

  IF v_limit IS NULL OR v_limit = 0 THEN
    v_demand_ratio := 0;
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;

  v_adjust := (0.5 * v_time_factor + 0.5 * v_demand_ratio) - 0.5;

  -- Add acceptance modifier (continuous impact from accept/reject events)
  v_acceptance_modifier := public.get_acceptance_modifier(p_instrument_id);

  v_price := v_base * (1 + v_flex * v_adjust) * (1 + v_acceptance_modifier) * (1 + v_noise_pct);

  IF v_price < 0.1 THEN
    v_price := 0.1;
  END IF;

  RETURN v_price;
END;
$$;
