CREATE TABLE IF NOT EXISTS public.price_noise_state (
  ticket_type_id UUID PRIMARY KEY REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  noise NUMERIC NOT NULL DEFAULT 0,
  last_hour TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.compute_noise_step(p_ticket_type_id UUID, p_noise NUMERIC, p_hour TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_instr RECORD;
  v_noise_pct NUMERIC;
  v_flex NUMERIC;
  v_limit INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_factor NUMERIC;
  v_total_sold INTEGER;
  v_demand_ratio NUMERIC;
  v_S NUMERIC;
  v_theta NUMERIC;
  v_sigma NUMERIC;
  v_p_bias NUMERIC;
  v_seed DOUBLE PRECISION;
  v_eps DOUBLE PRECISION;
  v_step NUMERIC;
  v_noise NUMERIC;
BEGIN
  SELECT i.* INTO v_instr
  FROM public.support_instruments i
  WHERE i.ticket_type_id = p_ticket_type_id
     OR i.ticket_type_a_id = p_ticket_type_id
     OR i.ticket_type_b_id = p_ticket_type_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN p_noise;
  END IF;
  v_noise_pct := COALESCE(v_instr.dynamic_noise_pct, 0) / 100.0;
  v_flex := COALESCE(v_instr.dynamic_flex_pct, 0);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
  v_open := COALESCE(v_instr.open_date, v_instr.created_at);
  v_end := CASE WHEN COALESCE(v_instr.is_driver_bet, false) THEN COALESCE(v_instr.open_date, v_instr.official_end_date, v_open)
                ELSE COALESCE(v_instr.official_end_date, v_open) END;
  IF v_end <= v_open THEN
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(v_total_interval, EXTRACT(EPOCH FROM (p_hour - v_open)))) END;
  v_time_factor := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  IF v_limit IS NULL OR v_limit = 0 THEN
    v_demand_ratio := 0;
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_S := 0.5 * v_time_factor + 0.5 * v_demand_ratio;
  v_theta := 0.1 + 0.3 * v_S;
  v_sigma := v_noise_pct * (0.5 + 0.5 * (1 - v_S));
  v_p_bias := LEAST(1, GREATEST(0, 0.55 + 0.4 * v_S));
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

CREATE OR REPLACE FUNCTION public.step_noise_for_hour(p_hour TIMESTAMPTZ)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  t UUID;
  v_curr RECORD;
  v_next NUMERIC;
BEGIN
  FOR t IN
    SELECT tt FROM (
      SELECT ticket_type_id AS tt FROM public.support_instruments WHERE ticket_type_id IS NOT NULL
      UNION ALL
      SELECT ticket_type_a_id FROM public.support_instruments WHERE ticket_type_a_id IS NOT NULL
      UNION ALL
      SELECT ticket_type_b_id FROM public.support_instruments WHERE ticket_type_b_id IS NOT NULL
    ) s
  LOOP
    SELECT noise, last_hour INTO v_curr FROM public.price_noise_state WHERE ticket_type_id = t;
    IF NOT FOUND THEN
      v_curr := ROW(0::NUMERIC, p_hour - INTERVAL '1 hour');
    END IF;
    IF v_curr.last_hour < p_hour THEN
      v_next := public.compute_noise_step(t, COALESCE(v_curr.noise, 0), p_hour);
      INSERT INTO public.price_noise_state (ticket_type_id, noise, last_hour, updated_at)
      VALUES (t, v_next, p_hour, NOW())
      ON CONFLICT (ticket_type_id)
      DO UPDATE SET noise = EXCLUDED.noise, last_hour = EXCLUDED.last_hour, updated_at = NOW();
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ticket_noise(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_hour TIMESTAMPTZ := date_trunc('hour', p_at);
  v_state RECORD;
  v_noise NUMERIC;
BEGIN
  SELECT noise, last_hour INTO v_state
  FROM public.price_noise_state
  WHERE ticket_type_id = p_ticket_type_id;
  IF FOUND AND v_state.last_hour >= v_hour THEN
    RETURN v_state.noise;
  END IF;
  v_noise := public.compute_noise_step(p_ticket_type_id, COALESCE(v_state.noise, 0), v_hour);
  RETURN v_noise;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_official_price_by_ticket_type_at(p_ticket_type_id UUID, p_at TIMESTAMPTZ)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_instr RECORD;
  v_base NUMERIC;
  v_flex NUMERIC;
  v_limit INTEGER;
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
  v_flex := COALESCE(v_instr.dynamic_flex_pct, 0);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
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
  IF v_limit IS NULL OR v_limit = 0 THEN
    v_demand_ratio := 0;
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_noise := public.get_ticket_noise(p_ticket_type_id, p_at);
  v_price := v_base * (1 + v_flex * (0.5 * v_time_factor + 0.5 * v_demand_ratio)) * (1 + v_noise);
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
  v_flex NUMERIC;
  v_limit INTEGER;
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
  v_flex := COALESCE(v_instr.dynamic_flex_pct, 0);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
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
  IF v_limit IS NULL OR v_limit = 0 THEN
    v_demand_ratio := 0;
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_noise := public.get_ticket_noise(p_ticket_type_id, NOW());
  v_price := v_base * (1 + v_flex * (0.5 * v_time_factor + 0.5 * v_demand_ratio)) * (1 + v_noise);
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
  v_flex NUMERIC;
  v_limit INTEGER;
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
  v_flex := COALESCE(v_instr.dynamic_flex_pct, 0);
  v_limit := COALESCE(v_instr.ticket_limit, 0);
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
  IF v_limit IS NULL OR v_limit = 0 THEN
    v_demand_ratio := 0;
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, ((v_total_sold + GREATEST(p_quantity, 0))::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_noise := public.get_ticket_noise(p_ticket_type_id, NOW());
  v_price := v_base * (1 + v_flex * (0.5 * v_time_factor + 0.5 * v_demand_ratio)) * (1 + v_noise);
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  RETURN v_price;
END;
$$;

SELECT cron.schedule('step_noise_hourly', '3 * * * *', $$ SELECT public.step_noise_for_hour(date_trunc('hour', NOW())) $$);

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Insert own ledger entries" ON public.ledger_entries;
DROP POLICY IF EXISTS "Insert market income ledger entries" ON public.ledger_entries;
CREATE POLICY "Insert own ledger entries" ON public.ledger_entries FOR INSERT
WITH CHECK (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));
CREATE POLICY "Insert market income ledger entries" ON public.ledger_entries FOR INSERT
WITH CHECK (operation_type IN ('BET_INCOME','TRADE_SELL','WIN','BET_PAYOUT','MARKET_PAYOUT'));
