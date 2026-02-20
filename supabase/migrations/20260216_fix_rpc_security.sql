-- Ensure RPC functions can read aggregated data under RLS and persist noise
-- by running as SECURITY DEFINER

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

-- Insert official prices at current/prev hour for recorder and immediate logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'official_price_history' AND policyname = 'Insert official prices at current/prev hour'
  ) THEN
    EXECUTE 'CREATE POLICY "Insert official prices at current/prev hour" ON public.official_price_history FOR INSERT WITH CHECK (date_trunc(''hour'', created_at) IN (date_trunc(''hour'', NOW()), date_trunc(''hour'', NOW()) - INTERVAL ''1 hour''))';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Allow reading creator wallets so purchase RPC can resolve wallet_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'wallets' AND policyname = 'Read creator wallets'
  ) THEN
    EXECUTE 'CREATE POLICY "Read creator wallets" ON public.wallets FOR SELECT USING (user_id = auth.uid() OR user_id IN (SELECT creator_id FROM public.support_instruments))';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Replace buy_driver_bet_ticket to avoid direct official_price_history writes (hourly recorder handles archival)
CREATE OR REPLACE FUNCTION public.buy_driver_bet_ticket(
  p_instrument_id UUID,
  p_side TEXT,
  p_quantity INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
  v_cost NUMERIC;
  v_creator_wallet_id UUID;
  v_buyer_wallet_id UUID;
BEGIN
  SELECT * INTO v_instrument FROM public.support_instruments WHERE id = p_instrument_id;
  IF NOT FOUND OR NOT COALESCE(v_instrument.is_driver_bet, false) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid instrument');
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
  SELECT 
    COALESCE(SUM(b.balance), 0) INTO v_group_total_sold
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
  v_price := (public.get_official_price_by_ticket_type(v_ticket_type_id)
              + public.get_official_price_for_purchase(v_ticket_type_id, p_quantity)) / 2.0;
  IF v_price < 0.1 THEN
    v_price := 0.1;
  END IF;
  v_cost := p_quantity * v_price;
  SELECT id INTO v_buyer_wallet_id FROM public.wallets WHERE user_id = v_user_id;
  SELECT id INTO v_creator_wallet_id FROM public.wallets WHERE user_id = v_instrument.creator_id;
  IF v_buyer_wallet_id IS NULL OR v_creator_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Wallet lookup failed');
  END IF;
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
  INSERT INTO public.ticket_transactions (listing_id, buyer_id, seller_id, ticket_type_id, quantity, price_per_unit, total_price)
  VALUES (NULL, v_user_id, v_instrument.creator_id, v_ticket_type_id, p_quantity, v_price, v_cost);
  RETURN jsonb_build_object('success', true, 'message', 'Tickets purchased', 'price', v_price);
END;
$$;

ALTER TABLE public.user_ticket_balances ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'user_ticket_balances' AND policyname = 'Insert own ticket balance'
  ) THEN
    EXECUTE 'CREATE POLICY "Insert own ticket balance" ON public.user_ticket_balances FOR INSERT WITH CHECK (auth.uid() = user_id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'user_ticket_balances' AND policyname = 'Update own ticket balance'
  ) THEN
    EXECUTE 'CREATE POLICY "Update own ticket balance" ON public.user_ticket_balances FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'user_ticket_balances' AND policyname = 'Admin function update balances'
  ) THEN
    EXECUTE 'CREATE POLICY "Admin function update balances" ON public.user_ticket_balances FOR UPDATE USING (current_user = ''postgres'') WITH CHECK (true)';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Allow definer to insert official hourly prices
ALTER TABLE public.official_price_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'official_price_history' AND policyname = 'Insert official prices via definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Insert official prices via definer" ON public.official_price_history FOR INSERT WITH CHECK (current_user = ''postgres'')';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Allow definer to read any wallet (needed for seller/creator payouts)
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'wallets' AND policyname = 'Read wallets via definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Read wallets via definer" ON public.wallets FOR SELECT USING (current_user = ''postgres'')';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Allow SECURITY DEFINER to update listings status (e.g., mark SOLD)
ALTER TABLE public.ticket_listings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'ticket_listings' 
      AND policyname = 'Update listings via definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Update listings via definer" ON public.ticket_listings 
             FOR UPDATE 
             USING (current_user = ''postgres'') 
             WITH CHECK (current_user = ''postgres'')';
  END IF;
END;
$$ LANGUAGE plpgsql;
-- Ensure user-level INSERT policy for ticket_transactions (buyer/seller + Rep > 50)
ALTER TABLE public.ticket_transactions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'ticket_transactions' 
      AND policyname = 'Users can create transactions'
  ) THEN
    EXECUTE 'CREATE POLICY "Users can create transactions" ON public.ticket_transactions 
             FOR INSERT 
             WITH CHECK (
               (auth.uid() = buyer_id OR auth.uid() = seller_id) 
               AND public.get_my_reputation() > 50
             )';
  END IF;
END;
$$ LANGUAGE plpgsql;
-- Allow SECURITY DEFINER RPCs to record market transactions
ALTER TABLE public.ticket_transactions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'ticket_transactions' AND policyname = 'Insert transactions via definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Insert transactions via definer" ON public.ticket_transactions FOR INSERT WITH CHECK (current_user = ''postgres'')';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'ticket_transactions' AND policyname = 'Insert own transactions'
  ) THEN
    EXECUTE 'CREATE POLICY "Insert own transactions" ON public.ticket_transactions FOR INSERT WITH CHECK (auth.uid() = buyer_id OR auth.uid() = seller_id)';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Allow SECURITY DEFINER to write official price history (hourly)
ALTER TABLE public.official_price_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'official_price_history' 
      AND policyname = 'Insert official history via definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Insert official history via definer" ON public.official_price_history 
             FOR INSERT 
             WITH CHECK (current_user = ''postgres'')';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'official_price_history' 
      AND policyname = 'Delete official history via definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Delete official history via definer" ON public.official_price_history 
             FOR DELETE 
             USING (current_user = ''postgres'')';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Allow SECURITY DEFINER to aggregate official daily price history
ALTER TABLE public.official_price_daily_history ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'official_price_daily_history' 
      AND policyname = 'Insert official daily via definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Insert official daily via definer" ON public.official_price_daily_history 
             FOR INSERT 
             WITH CHECK (current_user = ''postgres'')';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'official_price_daily_history' 
      AND policyname = 'Update official daily via definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Update official daily via definer" ON public.official_price_daily_history 
             FOR UPDATE 
             USING (current_user = ''postgres'') 
             WITH CHECK (current_user = ''postgres'')';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'official_price_daily_history' 
      AND policyname = 'Delete official daily via definer'
  ) THEN
    EXECUTE 'CREATE POLICY "Delete official daily via definer" ON public.official_price_daily_history 
             FOR DELETE 
             USING (current_user = ''postgres'')';
  END IF;
END;
$$ LANGUAGE plpgsql;

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
  v_p_bias NUMERIC;
  v_seed DOUBLE PRECISION;
  v_eps DOUBLE PRECISION;
  v_step NUMERIC;
  v_noise NUMERIC;
  v_exc NUMERIC;
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
  v_flex_d := COALESCE(v_instr.dynamic_flex_demand_pct, COALESCE(v_instr.dynamic_flex_pct, 0));
  v_flex_t := COALESCE(v_instr.dynamic_flex_time_pct, 0);
  v_sat := COALESCE(v_instr.demand_saturation_units, 100);
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
  v_time_progress := CASE WHEN v_total_interval = 0 THEN 0 ELSE v_elapsed / v_total_interval END;
  v_time_factor := CASE WHEN v_time_progress < 0 THEN 0 ELSE power(v_time_progress, 1.5) END;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id = p_ticket_type_id;
  v_demand_ratio := (v_total_sold::NUMERIC / v_sat::NUMERIC);
  v_demand_factor := power(v_demand_ratio, 0.7);
  v_theta := 0.1 + 0.3 * (0.5 * v_time_factor + 0.5 * v_demand_factor);
  v_theta := 0.02 + 0.08 * (0.5 * v_time_factor + 0.5 * v_demand_factor);
  v_sigma := v_noise_pct * (0.6 + 0.4 * (1 - (0.5 * v_time_factor + 0.5 * v_demand_factor))) * (1 - 0.3 * GREATEST(0, LEAST(1, abs(p_noise) / NULLIF(v_noise_pct,0))));
  v_p_bias := 0.0;
  v_seed := ((EXTRACT(EPOCH FROM p_hour) / 3600.0) + ascii(substr(p_ticket_type_id::text, 1, 1)) * 0.01);
  PERFORM setseed((v_seed - floor(v_seed))::double precision);
  v_eps := (random() + random() + random() - 1.5) * 2.0;
  v_step := -v_theta * p_noise + v_sigma * v_eps;
  v_exc := random();
  IF v_exc < (0.2 + 0.3 * (1 - GREATEST(0, LEAST(1, abs(p_noise) / NULLIF(v_noise_pct,0))))) THEN
    v_step := v_step + v_sigma * (random() - 0.5) * CASE WHEN p_noise >= 0 THEN 1 ELSE -1 END;
  END IF;
  v_noise := p_noise + v_step;
  v_noise := GREATEST(-v_noise_pct, LEAST(v_noise_pct, v_noise));
  RETURN v_noise;
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
  v_sat := COALESCE(v_instr.demand_saturation_units, 100);
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
  v_sat := COALESCE(v_instr.demand_saturation_units, 100);
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
  v_sat := COALESCE(v_instr.demand_saturation_units, 100);
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
