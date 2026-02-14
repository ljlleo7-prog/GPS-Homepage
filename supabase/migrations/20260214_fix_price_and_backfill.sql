-- Fix pricing logic to start at Base Price instead of 50% of Base Price
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
    v_total_interval := 0;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_elapsed := CASE WHEN v_total_interval = 0 THEN 0 ELSE GREATEST(0, LEAST(v_total_interval, EXTRACT(EPOCH FROM (NOW() - v_open)))) END;
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
  -- OLD: v_adjust := (0.5 * v_time_factor + 0.5 * v_demand_ratio) - 0.5;
  -- NEW: Range [0, 1], starting at 0 (Price = Base)
  v_adjust := (0.5 * v_time_factor + 0.5 * v_demand_ratio);
  v_price := v_base * (1 + v_flex * v_adjust) * (1 + v_noise_pct);
  IF v_price < 0.1 THEN
    v_price := 0.1;
  END IF;
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
  v_end := COALESCE(v_instr.official_end_date, v_open);
  
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
  
  v_price := v_base * (1 + v_flex * (0.5 * v_time_factor + 0.5 * v_demand_ratio));
  IF v_price < 0.1 THEN v_price := 0.1; END IF;
  
  RETURN v_price;
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
  -- OLD: v_adjust := (0.5 * v_time_factor + 0.5 * v_demand_ratio) - 0.5;
  -- NEW: Range [0, 1]
  v_adjust := (0.5 * v_time_factor + 0.5 * v_demand_ratio);
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
  -- Record transaction history
  INSERT INTO public.ticket_transactions (listing_id, buyer_id, seller_id, ticket_type_id, quantity, price_per_unit, total_price)
  VALUES (NULL, v_user_id, v_instrument.creator_id, v_ticket_type_id, p_quantity, v_price, v_cost);
  v_price := public.get_official_price_by_ticket_type(v_ticket_type_id);
  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price)
  VALUES (p_instrument_id, v_ticket_type_id, v_price);
  RETURN jsonb_build_object('success', true, 'message', 'Tickets purchased', 'price', v_price);
END;
$$;

-- Create backfill function
CREATE OR REPLACE FUNCTION public.fill_official_history_backfill()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_instr RECORD;
  v_t TIMESTAMPTZ;
  v_price NUMERIC;
  v_base NUMERIC;
  v_flex NUMERIC;
  v_total_sold INTEGER;
  v_limit INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_elapsed NUMERIC;
  v_time_factor NUMERIC;
  v_demand_ratio NUMERIC;
  v_adjust NUMERIC;
  v_group_total_sold INTEGER;
  v_group_limit INTEGER;
BEGIN
  -- Clear recent history to avoid duplicates if re-run? 
  -- No, let's just insert.
  
  FOR v_instr IN SELECT * FROM public.support_instruments WHERE deletion_status IS NULL OR deletion_status != 'DELETED_EVERYWHERE' LOOP
    v_open := COALESCE(v_instr.open_date, v_instr.created_at);
    v_end := COALESCE(v_instr.official_end_date, v_open + interval '1 year');
    
    -- Start from max(open, now - 30 days) to avoid too much data
    v_t := GREATEST(v_open, NOW() - interval '30 days');
    v_t := date_trunc('hour', v_t);

    WHILE v_t <= NOW() LOOP
        -- Calc Price logic inline
        v_base := COALESCE(v_instr.ticket_price, 1.0);
        v_flex := COALESCE(v_instr.dynamic_flex_pct, 0);
        v_limit := COALESCE(v_instr.ticket_limit, 0);
        
        IF v_end <= v_open THEN
            v_total_interval := 1;
        ELSE
            v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
        END IF;
        
        v_elapsed := GREATEST(0, LEAST(v_total_interval, EXTRACT(EPOCH FROM (v_t - v_open))));
        v_time_factor := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;

        -- Use current demand as approx
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

        v_adjust := (0.5 * v_time_factor + 0.5 * v_demand_ratio);
        v_price := v_base * (1 + v_flex * v_adjust);
        IF v_price < 0.1 THEN v_price := 0.1; END IF;

        IF v_instr.ticket_type_id IS NOT NULL THEN
            INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
            VALUES (v_instr.id, v_instr.ticket_type_id, v_price, v_t);
        END IF;
        
        IF v_instr.ticket_type_a_id IS NOT NULL THEN
             INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
             VALUES (v_instr.id, v_instr.ticket_type_a_id, v_price, v_t);
        END IF;
        IF v_instr.ticket_type_b_id IS NOT NULL THEN
             INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price, created_at)
             VALUES (v_instr.id, v_instr.ticket_type_b_id, v_price, v_t);
        END IF;

        v_t := v_t + interval '1 hour';
    END LOOP;
  END LOOP;
END;
$$;

-- Run backfill
SELECT public.fill_official_history_backfill();

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
BEGIN
  IF p_interval = '1d' THEN
    v_start := NOW() - INTERVAL '1 day';
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
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', t, 'price', avg_price) ORDER BY t),
      '[]'::jsonb
    ) INTO v_civil
    FROM (
      SELECT date_trunc('hour', created_at) AS t, AVG(price_per_unit) AS avg_price
      FROM public.ticket_transactions
      WHERE ticket_type_id = p_ticket_type_id
        AND listing_id IS NOT NULL
        AND created_at >= v_start
      GROUP BY 1
      ORDER BY 1
    ) s2;
  ELSIF p_interval = '1w' THEN
    v_start := NOW() - INTERVAL '7 days';
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
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', t, 'price', avg_price) ORDER BY t),
      '[]'::jsonb
    ) INTO v_civil
    FROM (
      SELECT date_trunc('hour', created_at) AS t, AVG(price_per_unit) AS avg_price
      FROM public.ticket_transactions
      WHERE ticket_type_id = p_ticket_type_id
        AND listing_id IS NOT NULL
        AND created_at >= v_start
      GROUP BY 1
      ORDER BY 1
    ) s2;
  ELSE
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', day, 'price', avg_price) ORDER BY day),
      '[]'::jsonb
    ) INTO v_official
    FROM public.official_price_daily_history
    WHERE ticket_type_id = p_ticket_type_id
      AND day >= (CURRENT_DATE - INTERVAL '30 days');
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('t', day, 'price', avg_price) ORDER BY day),
      '[]'::jsonb
    ) INTO v_civil
    FROM public.civil_price_daily_history
    WHERE ticket_type_id = p_ticket_type_id
      AND day >= (CURRENT_DATE - INTERVAL '30 days');
  END IF;
  RETURN jsonb_build_object('official', v_official, 'civil', v_civil);
END;
$$;

CREATE OR REPLACE FUNCTION public.compress_price_histories()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $cmp$
DECLARE
  v_rows INTEGER := 0;
BEGIN
  INSERT INTO public.official_price_daily_history (instrument_id, ticket_type_id, day, avg_price)
  SELECT instrument_id, ticket_type_id, DATE(created_at) AS day, AVG(price) AS avg_price
  FROM public.official_price_history
  WHERE created_at < NOW() - INTERVAL '24 hours'
  GROUP BY instrument_id, ticket_type_id, DATE(created_at)
  ON CONFLICT (instrument_id, ticket_type_id, day) DO UPDATE
    SET avg_price = EXCLUDED.avg_price;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  DELETE FROM public.official_price_history
  WHERE created_at < NOW() - INTERVAL '24 hours';
  DELETE FROM public.official_price_daily_history
  WHERE day < CURRENT_DATE - INTERVAL '30 days';
  INSERT INTO public.civil_price_daily_history (ticket_type_id, day, avg_price)
  SELECT ticket_type_id, DATE(created_at) AS day, AVG(price_per_unit) AS avg_price
  FROM public.ticket_transactions
  WHERE created_at < NOW() - INTERVAL '24 hours'
    AND listing_id IS NOT NULL
  GROUP BY ticket_type_id, DATE(created_at)
  ON CONFLICT (ticket_type_id, day) DO UPDATE
    SET avg_price = EXCLUDED.avg_price;
  DELETE FROM public.civil_price_daily_history
  WHERE day < CURRENT_DATE - INTERVAL '30 days';
  RETURN jsonb_build_object('success', true, 'processed', COALESCE(v_rows, 0));
END;
$cmp$;

CREATE OR REPLACE FUNCTION public.get_civil_avg_price(p_ticket_type_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $avg$
DECLARE
  v_avg NUMERIC;
BEGIN
  SELECT AVG(price_per_unit) INTO v_avg
  FROM public.ticket_transactions
  WHERE ticket_type_id = p_ticket_type_id
    AND listing_id IS NOT NULL
    AND created_at >= NOW() - INTERVAL '24 hours';
  RETURN v_avg;
END;
$avg$;
