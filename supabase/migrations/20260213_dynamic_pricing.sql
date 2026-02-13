ALTER TABLE public.support_instruments
ADD COLUMN IF NOT EXISTS dynamic_noise_pct NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS dynamic_flex_pct NUMERIC DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.official_price_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  instrument_id UUID REFERENCES public.support_instruments(id) ON DELETE CASCADE NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
  price NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.official_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Official price history is viewable by everyone" ON public.official_price_history FOR SELECT USING (true);

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
    -- Combine demand across all driver bet instruments with the same title
    SELECT 
      COALESCE(SUM(b.balance), 0) AS total_sold
    INTO v_group_total_sold
    FROM public.support_instruments i
    LEFT JOIN public.user_ticket_balances b
      ON b.ticket_type_id IN (i.ticket_type_a_id, i.ticket_type_b_id)
    WHERE i.is_driver_bet = true
      AND i.title = v_instr.title;
    v_total_sold := COALESCE(v_group_total_sold, 0);
    SELECT COALESCE(SUM(COALESCE(i.ticket_limit, 0)), 0) INTO v_group_limit
    FROM public.support_instruments i
    WHERE i.is_driver_bet = true
      AND i.title = v_instr.title;
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
  v_price := v_base * (1 + v_flex * v_adjust) * (1 + v_noise_pct);
  IF v_price < 0.1 THEN
    v_price := 0.1;
  END IF;
  RETURN v_price;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ticket_price_trend(
  p_ticket_type_id UUID,
  p_interval TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_official JSONB;
  v_civil JSONB;
  v_instr_id UUID;
BEGIN
  -- Resolve instrument id for this ticket type
  SELECT id INTO v_instr_id
  FROM public.support_instruments
  WHERE ticket_type_id = p_ticket_type_id
     OR ticket_type_a_id = p_ticket_type_id
     OR ticket_type_b_id = p_ticket_type_id
  LIMIT 1;

  IF p_interval = '1d' THEN
    v_start := NOW() - INTERVAL '1 day';
    -- Hourly official
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', t, 'price', avg_price) ORDER BY t),
      '[]'::jsonb
    ) INTO v_official
    FROM (
      SELECT date_trunc('hour', created_at) AS t, AVG(price) AS avg_price
      FROM public.official_price_history
      WHERE ticket_type_id = p_ticket_type_id
        AND created_at >= v_start
      GROUP BY 1
      ORDER BY 1
    ) s;
    -- Hourly civil with fallback to official price
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', h.ts, 'price', COALESCE(c.avg_price, public.get_official_price(v_instr_id))) ORDER BY h.ts),
      '[]'::jsonb
    ) INTO v_civil
    FROM (
      SELECT generate_series(date_trunc('hour', v_start), date_trunc('hour', NOW()), INTERVAL '1 hour') AS ts
    ) h
    LEFT JOIN (
      SELECT date_trunc('hour', created_at) AS t, AVG(price_per_unit) AS avg_price
      FROM public.ticket_transactions
      WHERE ticket_type_id = p_ticket_type_id
        AND created_at >= v_start
      GROUP BY 1
    ) c ON c.t = h.ts;
  ELSIF p_interval = '1w' THEN
    v_start := NOW() - INTERVAL '7 days';
    -- Hourly official
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', t, 'price', avg_price) ORDER BY t),
      '[]'::jsonb
    ) INTO v_official
    FROM (
      SELECT date_trunc('hour', created_at) AS t, AVG(price) AS avg_price
      FROM public.official_price_history
      WHERE ticket_type_id = p_ticket_type_id
        AND created_at >= v_start
      GROUP BY 1
      ORDER BY 1
    ) s;
    -- Hourly civil with fallback
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', h.ts, 'price', COALESCE(c.avg_price, public.get_official_price(v_instr_id))) ORDER BY h.ts),
      '[]'::jsonb
    ) INTO v_civil
    FROM (
      SELECT generate_series(date_trunc('hour', v_start), date_trunc('hour', NOW()), INTERVAL '1 hour') AS ts
    ) h
    LEFT JOIN (
      SELECT date_trunc('hour', created_at) AS t, AVG(price_per_unit) AS avg_price
      FROM public.ticket_transactions
      WHERE ticket_type_id = p_ticket_type_id
        AND created_at >= v_start
      GROUP BY 1
    ) c ON c.t = h.ts;
  ELSE
    v_start := NOW() - INTERVAL '30 days';
    -- Daily official
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', day, 'price', avg_price) ORDER BY day),
      '[]'::jsonb
    ) INTO v_official
    FROM public.official_price_daily_history
    WHERE ticket_type_id = p_ticket_type_id
      AND day >= (CURRENT_DATE - INTERVAL '30 days');
    -- Daily civil with fallback
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', day, 'price', COALESCE(avg_price, public.get_official_price(v_instr_id))) ORDER BY day),
      '[]'::jsonb
    ) INTO v_civil
    FROM public.civil_price_daily_history
    WHERE ticket_type_id = p_ticket_type_id
      AND day >= (CURRENT_DATE - INTERVAL '30 days');
  END IF;

  RETURN jsonb_build_object('official', v_official, 'civil', v_civil);
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_driver_bet_ticket(
  p_instrument_id UUID,
  p_side TEXT,
  p_quantity INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_instrument RECORD;
  v_ticket_type_id UUID;
  v_price NUMERIC;
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
  v_noise_pct NUMERIC;
  v_cost NUMERIC;
  v_creator_wallet_id UUID;
  v_buyer_wallet_id UUID;
BEGIN
  SELECT * INTO v_instrument FROM public.support_instruments WHERE id = p_instrument_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Instrument not found');
  END IF;
  IF NOT COALESCE(v_instrument.is_driver_bet, false) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not a Driver Bet');
  END IF;
  IF NOW() > v_instrument.official_end_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Official sales have ended');
  END IF;
  IF p_side = 'A' THEN
    v_ticket_type_id := v_instrument.ticket_type_a_id;
  ELSIF p_side = 'B' THEN
    v_ticket_type_id := v_instrument.ticket_type_b_id;
  ELSE
    RETURN jsonb_build_object('success', false, 'message', 'Invalid side');
  END IF;
  -- Combine across all instruments with same title
  SELECT 
    COALESCE(SUM(b.balance), 0) AS total_sold
  INTO v_group_total_sold
  FROM public.support_instruments i
  LEFT JOIN public.user_ticket_balances b
    ON b.ticket_type_id IN (i.ticket_type_a_id, i.ticket_type_b_id)
  WHERE i.is_driver_bet = true
    AND i.title = v_instrument.title;
  v_total_sold := COALESCE(v_group_total_sold, 0);
  SELECT COALESCE(SUM(COALESCE(i.ticket_limit, 0)), 0) INTO v_group_limit
  FROM public.support_instruments i
  WHERE i.is_driver_bet = true
    AND i.title = v_instrument.title;
  v_limit := COALESCE(v_group_limit, COALESCE(v_instrument.ticket_limit, 0));
  IF v_limit > 0 AND v_total_sold + p_quantity > v_limit THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ticket limit reached');
  END IF;
  v_open := COALESCE(v_instrument.open_date, v_instrument.created_at);
  v_end := COALESCE(v_instrument.official_end_date, v_open);
  IF v_end <= v_open THEN
    v_total_interval := 1;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := GREATEST(0, LEAST(v_total_interval, EXTRACT(EPOCH FROM (NOW() - v_open))));
  v_time_factor := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
  IF v_limit IS NULL OR v_limit = 0 THEN
    v_demand_ratio := 0;
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, ((v_total_sold)::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_adjust := (0.5 * v_time_factor + 0.5 * v_demand_ratio) - 0.5;
  v_noise_pct := COALESCE(v_instrument.dynamic_noise_pct, 0) / 100.0 * ((random() * 2) - 1);
  v_price := COALESCE(v_instrument.ticket_price, 1.0) * (1 + COALESCE(v_instrument.dynamic_flex_pct, 0) * v_adjust) * (1 + v_noise_pct);
  IF v_price < 0.1 THEN
    v_price := 0.1;
  END IF;
  v_cost := p_quantity * v_price;
  SELECT id INTO v_buyer_wallet_id FROM public.wallets WHERE user_id = v_user_id;
  SELECT id INTO v_creator_wallet_id FROM public.wallets WHERE user_id = v_instrument.creator_id;
  IF (SELECT token_balance FROM public.wallets WHERE id = v_buyer_wallet_id) < v_cost THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient funds');
  END IF;
  UPDATE public.wallets SET token_balance = token_balance - v_cost WHERE id = v_buyer_wallet_id;
  UPDATE public.wallets SET token_balance = token_balance + v_cost WHERE id = v_creator_wallet_id;
  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_buyer_wallet_id, -v_cost, 'TOKEN', 'BUY_BET', 'Bought ' || p_quantity || ' tickets for ' || v_instrument.title);
  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_creator_wallet_id, v_cost, 'TOKEN', 'BET_INCOME', 'Sold ' || p_quantity || ' tickets for ' || v_instrument.title);
  INSERT INTO public.user_ticket_balances (user_id, ticket_type_id, balance)
  VALUES (v_user_id, v_ticket_type_id, p_quantity)
  ON CONFLICT (user_id, ticket_type_id)
  DO UPDATE SET balance = public.user_ticket_balances.balance + p_quantity;
  -- Record transaction history for average price computation
  INSERT INTO public.ticket_transactions (listing_id, buyer_id, seller_id, ticket_type_id, quantity, price_per_unit, total_price)
  VALUES (NULL, v_user_id, v_instrument.creator_id, v_ticket_type_id, p_quantity, v_price, v_cost);
  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price)
  VALUES (p_instrument_id, v_instrument.ticket_type_a_id, v_price);
  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price)
  VALUES (p_instrument_id, v_instrument.ticket_type_b_id, v_price);
  RETURN jsonb_build_object('success', true, 'message', 'Tickets purchased', 'price', v_price);
END;
$$;

-- Disable Variable Price for an instrument (developer tool)
CREATE OR REPLACE FUNCTION public.disable_variable_price(p_instrument_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_dev BOOLEAN;
BEGIN
  -- Only approved developers can perform this action
  SELECT (COALESCE(developer_status, 'NONE') = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_user_id;
  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  UPDATE public.support_instruments
  SET dynamic_flex_pct = 0,
      dynamic_noise_pct = 0
  WHERE id = p_instrument_id;

  RETURN jsonb_build_object('success', true);
END;
$func$;

-- Get user's weighted average buy price for a ticket type
CREATE OR REPLACE FUNCTION public.get_avg_buy_price(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $avg$
DECLARE
  v_user_id UUID := auth.uid();
  v_sum_total NUMERIC := 0;
  v_sum_qty INTEGER := 0;
BEGIN
  SELECT COALESCE(SUM(total_price), 0), COALESCE(SUM(quantity), 0)
  INTO v_sum_total, v_sum_qty
  FROM public.ticket_transactions
  WHERE buyer_id = v_user_id
    AND ticket_type_id = p_ticket_type_id;
  
  IF v_sum_qty = 0 THEN
    RETURN NULL;
  END IF;
  
  RETURN v_sum_total / v_sum_qty;
END;
$avg$;

-- Daily aggregated tables for retention
CREATE TABLE IF NOT EXISTS public.official_price_daily_history (
  instrument_id UUID REFERENCES public.support_instruments(id) ON DELETE CASCADE NOT NULL,
  ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
  day DATE NOT NULL,
  avg_price NUMERIC NOT NULL,
  PRIMARY KEY (instrument_id, ticket_type_id, day)
);
ALTER TABLE public.official_price_daily_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Official daily price history is viewable by everyone" ON public.official_price_daily_history FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.civil_price_daily_history (
  ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
  day DATE NOT NULL,
  avg_price NUMERIC NOT NULL,
  PRIMARY KEY (ticket_type_id, day)
);
ALTER TABLE public.civil_price_daily_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Civil daily price history is viewable by everyone" ON public.civil_price_daily_history FOR SELECT USING (true);

-- Backfill official hourly history with current price from creation to now
CREATE OR REPLACE FUNCTION public.fill_official_history_backfill(p_instrument_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $bf$
DECLARE
  v_instr RECORD;
  v_price NUMERIC;
  v_start TIMESTAMPTZ;
  v_ts TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_instr FROM public.support_instruments WHERE id = p_instrument_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Instrument not found');
  END IF;
  v_price := public.get_official_price(p_instrument_id);
  v_start := COALESCE(v_instr.created_at, NOW());
  FOR v_ts IN SELECT generate_series(date_trunc('hour', v_start), date_trunc('hour', NOW()), INTERVAL '1 hour')
  LOOP
    -- Insert for side A/B if present
    IF v_instr.ticket_type_a_id IS NOT NULL THEN
      INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
      SELECT p_instrument_id, v_instr.ticket_type_a_id, v_price, v_ts
      WHERE NOT EXISTS (
        SELECT 1 FROM public.official_price_history 
        WHERE instrument_id = p_instrument_id AND ticket_type_id = v_instr.ticket_type_a_id AND created_at = v_ts
      );
    END IF;
    IF v_instr.ticket_type_b_id IS NOT NULL THEN
      INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
      SELECT p_instrument_id, v_instr.ticket_type_b_id, v_price, v_ts
      WHERE NOT EXISTS (
        SELECT 1 FROM public.official_price_history 
        WHERE instrument_id = p_instrument_id AND ticket_type_id = v_instr.ticket_type_b_id AND created_at = v_ts
      );
    END IF;
    -- Propagate to instruments with same title (if any duplicates exist)
    INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
    SELECT i.id, i.ticket_type_a_id, v_price, v_ts
    FROM public.support_instruments i
    WHERE i.is_driver_bet = true AND i.title = v_instr.title AND i.ticket_type_a_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.official_price_history 
        WHERE instrument_id = i.id AND ticket_type_id = i.ticket_type_a_id AND created_at = v_ts
      );
    INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
    SELECT i.id, i.ticket_type_b_id, v_price, v_ts
    FROM public.support_instruments i
    WHERE i.is_driver_bet = true AND i.title = v_instr.title AND i.ticket_type_b_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.official_price_history 
        WHERE instrument_id = i.id AND ticket_type_id = i.ticket_type_b_id AND created_at = v_ts
      );
  END LOOP;
  RETURN jsonb_build_object('success', true);
END;
$bf$;

-- Compression and retention: hourly >7d -> daily avg; daily >30d delete
CREATE OR REPLACE FUNCTION public.compress_price_histories()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $cmp$
DECLARE
  v_rows INTEGER := 0;
BEGIN
  -- Official: aggregate hourly older than 7 days into daily
  INSERT INTO public.official_price_daily_history (instrument_id, ticket_type_id, day, avg_price)
  SELECT instrument_id, ticket_type_id, DATE(created_at) AS day, AVG(price) AS avg_price
  FROM public.official_price_history
  WHERE created_at < NOW() - INTERVAL '7 days'
  GROUP BY instrument_id, ticket_type_id, DATE(created_at)
  ON CONFLICT (instrument_id, ticket_type_id, day) DO UPDATE
    SET avg_price = EXCLUDED.avg_price;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  
  -- Delete hourly older than 7 days
  DELETE FROM public.official_price_history
  WHERE created_at < NOW() - INTERVAL '7 days';

  -- Delete official daily older than 30 days
  DELETE FROM public.official_price_daily_history
  WHERE day < CURRENT_DATE - INTERVAL '30 days';

  -- Civil: aggregate transactions older than 7 days into daily
  INSERT INTO public.civil_price_daily_history (ticket_type_id, day, avg_price)
  SELECT ticket_type_id, DATE(created_at) AS day, AVG(price_per_unit) AS avg_price
  FROM public.ticket_transactions
  WHERE created_at < NOW() - INTERVAL '7 days'
  GROUP BY ticket_type_id, DATE(created_at)
  ON CONFLICT (ticket_type_id, day) DO UPDATE
    SET avg_price = EXCLUDED.avg_price;

  -- Delete civil daily older than 30 days
  DELETE FROM public.civil_price_daily_history
  WHERE day < CURRENT_DATE - INTERVAL '30 days';

  RETURN jsonb_build_object('success', true, 'processed', COALESCE(v_rows, 0));
END;
$cmp$;
