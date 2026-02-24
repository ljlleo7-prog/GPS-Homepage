-- Fix Purchase Misalignment: Use current official price directly without slippage/midpoint calculation

-- 1. Fix buy_campaign_ticket (Support Markets)
CREATE OR REPLACE FUNCTION public.buy_campaign_ticket(
  p_instrument_id UUID,
  p_amount INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_instrument RECORD;
  v_cost NUMERIC;
  v_wallet_id UUID;
  v_dev_count INTEGER;
  v_share_per_dev NUMERIC;
BEGIN
  SELECT * INTO v_instrument 
  FROM public.support_instruments 
  WHERE id = p_instrument_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Campaign not found');
  END IF;

  IF v_instrument.deletion_status != 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Campaign is not active for purchasing');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid ticket amount');
  END IF;

  -- Quantity-aware price: use current official price directly (no slippage/midpoint)
  v_cost := p_amount * public.get_official_price_by_ticket_type(v_instrument.ticket_type_id);

  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id;

  UPDATE public.wallets
  SET token_balance = token_balance - v_cost
  WHERE id = v_wallet_id AND token_balance >= v_cost;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient funds');
  END IF;

  INSERT INTO public.user_ticket_balances (user_id, ticket_type_id, balance)
  VALUES (v_user_id, v_instrument.ticket_type_id, p_amount)
  ON CONFLICT (user_id, ticket_type_id) 
  DO UPDATE SET balance = user_ticket_balances.balance + p_amount;

  INSERT INTO public.ledger_entries (
    wallet_id, amount, currency, operation_type, description
  ) VALUES (
    v_wallet_id, -v_cost, 'TOKEN', 'INVESTMENT', 'Bought tickets for: ' || v_instrument.title
  );

  SELECT COUNT(*) INTO v_dev_count
  FROM public.profiles p
  JOIN public.wallets w ON w.user_id = p.id
  WHERE p.developer_status = 'APPROVED';

  IF v_dev_count > 0 THEN
    v_share_per_dev := v_cost / v_dev_count;

    UPDATE public.wallets w
    SET token_balance = token_balance + v_share_per_dev
    WHERE w.user_id IN (SELECT id FROM public.profiles WHERE developer_status = 'APPROVED');

    INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
    SELECT w.id, v_share_per_dev, 'TOKEN', 'MARKET_POOL_INCOME', 'Anonymous instrument sale income'
    FROM public.wallets w
    JOIN public.profiles p ON w.user_id = p.id
    WHERE p.developer_status = 'APPROVED';
  END IF;

  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price)
  VALUES (p_instrument_id, v_instrument.ticket_type_id, public.get_official_price_by_ticket_type(v_instrument.ticket_type_id));

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Fix buy_driver_bet_ticket (Driver Bets)
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
  
  -- Use current official price directly (no slippage/midpoint)
  v_price := public.get_official_price_by_ticket_type(v_ticket_type_id);

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
  -- Record transaction using v_price (which is now the fixed unit price)
  INSERT INTO public.ticket_transactions (listing_id, buyer_id, seller_id, ticket_type_id, quantity, price_per_unit, total_price)
  VALUES (NULL, v_user_id, v_instrument.creator_id, v_ticket_type_id, p_quantity, v_price, v_cost);
  RETURN jsonb_build_object('success', true, 'message', 'Tickets purchased', 'price', v_price);
END;
$$;
