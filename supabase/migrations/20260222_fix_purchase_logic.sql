-- Fix Purchase Logic and Weighted Average Payouts
-- 1. Fix buy_campaign_ticket to use current unit price (no averaging with future price)
-- 2. Fix buy_driver_bet_ticket to use current unit price (no averaging with future price)
-- 3. Update resolve_driver_bet to use weighted average price of both sides for resolution

-- 1. Fix buy_campaign_ticket
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
  v_unit_price NUMERIC;
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

  -- FIXED: Use current official price directly
  v_unit_price := public.get_official_price_by_ticket_type(v_instrument.ticket_type_id);
  v_cost := p_amount * v_unit_price;

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
  VALUES (p_instrument_id, v_instrument.ticket_type_id, v_unit_price);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Fix buy_driver_bet_ticket
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
  v_cost NUMERIC;
  v_total_sold INTEGER;
  v_limit INTEGER;
  v_group_total_sold INTEGER;
  v_group_limit INTEGER;
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
  
  -- Check limits
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

  -- FIXED: Use current official price directly
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
  
  INSERT INTO public.ticket_transactions (listing_id, buyer_id, seller_id, ticket_type_id, quantity, price_per_unit, total_price)
  VALUES (NULL, v_user_id, v_instrument.creator_id, v_ticket_type_id, p_quantity, v_price, v_cost);
  
  RETURN jsonb_build_object('success', true, 'message', 'Tickets purchased', 'price', v_price);
END;
$$;

-- 3. Update resolve_driver_bet to use weighted average price
CREATE OR REPLACE FUNCTION public.resolve_driver_bet(
  p_instrument_id UUID,
  p_winning_side TEXT, -- 'A' or 'B'
  p_proof_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_instrument RECORD;
  v_creator_rep NUMERIC;
  v_creator_wallet_id UUID;
  v_creator_user_id UUID;
  v_developer_status TEXT;
  
  v_winning_ticket_count INTEGER;
  v_losing_ticket_count INTEGER;
  v_winning_type_id UUID;
  v_losing_type_id UUID;
  v_side_name TEXT;
  
  v_base_price NUMERIC;
  v_winning_price NUMERIC;
  v_losing_price NUMERIC;
  v_weighted_avg_price NUMERIC;
  v_resolution_price NUMERIC;
  v_total_payout NUMERIC;
  
  v_host_balance NUMERIC;
  v_bankrupt BOOLEAN := false;
  v_available_payout NUMERIC;
  v_payout_amount NUMERIC;
  v_holder RECORD;
BEGIN
  -- 1. Get Instrument & Validation
  SELECT * INTO v_instrument FROM public.support_instruments WHERE id = p_instrument_id;
  
  IF NOT FOUND OR NOT v_instrument.is_driver_bet THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid instrument');
  END IF;

  -- CHECK 1: Release Date
  IF NOW() < v_instrument.open_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cannot release result before Release Date (' || v_instrument.open_date || ')');
  END IF;

  -- CHECK 2: Proof URL
  IF p_proof_url IS NULL OR length(trim(p_proof_url)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Proof URL is required (e.g. F1 Official Website)');
  END IF;
  
  -- CHECK 3: Authority
  v_creator_user_id := v_instrument.creator_id;
  SELECT developer_status INTO v_developer_status FROM public.profiles WHERE id = v_user_id;
  SELECT reputation_balance INTO v_creator_rep FROM public.wallets WHERE user_id = v_user_id;
  
  -- Logic: Rep 70+ or Dev can resolve
  IF v_developer_status != 'APPROVED' AND v_creator_rep < 70 THEN
     RETURN jsonb_build_object('success', false, 'message', 'Insufficient authority to resolve. Rep > 70 or Developer status required.');
  END IF;

  -- 2. Determine Winner and Loser
  IF p_winning_side = 'A' THEN
      v_winning_type_id := v_instrument.ticket_type_a_id;
      v_losing_type_id := v_instrument.ticket_type_b_id;
      v_side_name := v_instrument.side_a_name;
  ELSE
      v_winning_type_id := v_instrument.ticket_type_b_id;
      v_losing_type_id := v_instrument.ticket_type_a_id;
      v_side_name := v_instrument.side_b_name;
  END IF;

  -- Get Ticket Counts
  SELECT COALESCE(SUM(balance), 0) INTO v_winning_ticket_count 
  FROM public.user_ticket_balances 
  WHERE ticket_type_id = v_winning_type_id;

  SELECT COALESCE(SUM(balance), 0) INTO v_losing_ticket_count 
  FROM public.user_ticket_balances 
  WHERE ticket_type_id = v_losing_type_id;

  -- 3. Calculate Resolution Price (Weighted Average + Capped)
  -- Base Price
  v_base_price := COALESCE(v_instrument.ticket_price, 1.0);
  
  -- Get Current Prices for both sides
  v_winning_price := public.get_official_price_by_ticket_type_at(v_winning_type_id, NOW());
  v_losing_price := public.get_official_price_by_ticket_type_at(v_losing_type_id, NOW());
  
  -- Calculate Weighted Average
  IF (v_winning_ticket_count + v_losing_ticket_count) > 0 THEN
    v_weighted_avg_price := (v_winning_price * v_winning_ticket_count + v_losing_price * v_losing_ticket_count) / (v_winning_ticket_count + v_losing_ticket_count);
  ELSE
    v_weighted_avg_price := (v_winning_price + v_losing_price) / 2.0;
  END IF;
  
  -- Cap Formula: P_res = Base + Base * tanh((WeightedAvg - Base) / Base)
  IF v_base_price > 0 THEN
    v_resolution_price := v_base_price + v_base_price * TANH((v_weighted_avg_price - v_base_price) / v_base_price);
  ELSE
    v_resolution_price := v_weighted_avg_price;
  END IF;
  
  -- Safety Floor
  IF v_resolution_price < 0.1 THEN v_resolution_price := 0.1; END IF;
  
  v_total_payout := v_winning_ticket_count::NUMERIC * v_resolution_price;
  
  -- 4. Check Host Bankruptcy
  SELECT id INTO v_creator_wallet_id FROM public.wallets WHERE user_id = v_creator_user_id;
  SELECT token_balance INTO v_host_balance FROM public.wallets WHERE id = v_creator_wallet_id;
  
  IF v_host_balance < v_total_payout THEN
    v_bankrupt := true;
    v_available_payout := v_host_balance; -- Host pays all they have
  ELSE
    v_available_payout := v_total_payout;
  END IF;

  -- 5. Execute Payouts
  -- Distribute to winners
  FOR v_holder IN 
    SELECT user_id, balance 
    FROM public.user_ticket_balances 
    WHERE ticket_type_id = v_winning_type_id AND balance > 0
  LOOP
    -- Calculate share
    IF v_winning_ticket_count > 0 THEN
      v_payout_amount := (v_holder.balance::NUMERIC / v_winning_ticket_count::NUMERIC) * v_available_payout;
    ELSE
      v_payout_amount := 0;
    END IF;
    
    -- Transfer
    IF v_payout_amount > 0 THEN
       UPDATE public.wallets SET token_balance = token_balance + v_payout_amount WHERE user_id = v_holder.user_id;
       UPDATE public.wallets SET token_balance = token_balance - v_payout_amount WHERE id = v_creator_wallet_id;
       
       INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
       VALUES ((SELECT id FROM public.wallets WHERE user_id = v_holder.user_id), v_payout_amount, 'TOKEN', 'BET_WIN', 'Won bet: ' || v_instrument.title || ' (' || v_side_name || ')');
    END IF;
  END LOOP;
  
  -- 6. Log Host Bankruptcy if applicable
  IF v_bankrupt THEN
     INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
     VALUES (v_creator_wallet_id, 0, 'TOKEN', 'BANKRUPTCY', 'Host bankrupt on bet: ' || v_instrument.title);
  ELSE
     INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
     VALUES (v_creator_wallet_id, -v_available_payout, 'TOKEN', 'BET_PAYOUT', 'Paid out winners for: ' || v_instrument.title);
  END IF;
  
  -- 7. Update Instrument Status
  UPDATE public.support_instruments 
  SET deletion_status = 'RESOLVED',
      winning_side = p_winning_side,
      proof_url = p_proof_url
  WHERE id = p_instrument_id;
  
  RETURN jsonb_build_object(
    'success', true, 
    'message', 'Bet resolved successfully', 
    'payout_per_ticket', v_resolution_price,
    'total_payout', v_available_payout,
    'bankrupt', v_bankrupt,
    'weighted_avg_price', v_weighted_avg_price
  );
END;
$$;
