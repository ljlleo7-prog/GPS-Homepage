-- Fix Driver Bet Resolution with Capped Pricing (Tanh Curve)
-- Addresses issue where demand-based pricing causes resolution price to skyrocket, potentially bankrupting the host.
-- New Formula: ResolutionPrice = BasePrice + BasePrice * tanh((MarketPrice - BasePrice) / BasePrice)
-- This caps the resolution price at roughly 2x BasePrice while following market price for small deviations.

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
  v_winning_type_id UUID;
  v_losing_type_id UUID;
  v_side_name TEXT;
  
  v_base_price NUMERIC;
  v_final_price NUMERIC;
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
  -- The 'open_date' is the Result Release Date for Driver Bets
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

  -- 2. Determine Winner
  IF p_winning_side = 'A' THEN
      v_winning_type_id := v_instrument.ticket_type_a_id;
      v_losing_type_id := v_instrument.ticket_type_b_id;
      v_side_name := v_instrument.side_a_name;
  ELSE
      v_winning_type_id := v_instrument.ticket_type_b_id;
      v_losing_type_id := v_instrument.ticket_type_a_id;
      v_side_name := v_instrument.side_b_name;
  END IF;

  SELECT COALESCE(SUM(balance), 0) INTO v_winning_ticket_count 
  FROM public.user_ticket_balances 
  WHERE ticket_type_id = v_winning_type_id;

  -- 3. Calculate Resolution Price (CAPPED)
  -- Base Price
  v_base_price := COALESCE(v_instrument.ticket_price, 1.0);
  
  -- Final Market Price (Current Official Price)
  v_final_price := public.get_official_price_by_ticket_type_at(v_winning_type_id, NOW());
  
  -- Cap Formula: P_res = Base + Base * tanh((Final - Base) / Base)
  -- This caps max payout at approx 2x Base Price
  IF v_base_price > 0 THEN
    v_resolution_price := v_base_price + v_base_price * TANH((v_final_price - v_base_price) / v_base_price);
  ELSE
    v_resolution_price := v_final_price;
  END IF;
  
  -- Safety Floor
  IF v_resolution_price < 0.1 THEN v_resolution_price := 0.1; END IF;
  
  v_total_payout := v_winning_ticket_count::NUMERIC * v_resolution_price;

  -- 4. Process Payout
  SELECT id, token_balance INTO v_creator_wallet_id, v_host_balance 
  FROM public.wallets WHERE user_id = v_creator_user_id;

  IF v_winning_ticket_count > 0 THEN
      -- Check Host Solvency
      IF v_host_balance < v_total_payout THEN
        v_bankrupt := true;
        v_available_payout := v_host_balance; -- All they have
        
        -- Penalty: Drain wallet & Rep Hit
        UPDATE public.wallets 
        SET reputation_balance = reputation_balance - 10,
            token_balance = 0 
        WHERE id = v_creator_wallet_id;
        
        INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
        VALUES (v_creator_wallet_id, -v_host_balance, 'TOKEN', 'BANKRUPTCY', 'Failed to pay bet: ' || v_instrument.title);

      ELSE
        v_available_payout := v_total_payout;
        -- Deduct from Host
        UPDATE public.wallets 
        SET token_balance = token_balance - v_total_payout 
        WHERE id = v_creator_wallet_id;
        
        INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
        VALUES (v_creator_wallet_id, -v_total_payout, 'TOKEN', 'BET_PAYOUT', 'Payout for: ' || v_instrument.title);
      END IF;

      -- Distribute to Winners
      FOR v_holder IN 
        SELECT user_id, balance 
        FROM public.user_ticket_balances 
        WHERE ticket_type_id = v_winning_type_id AND balance > 0
      LOOP
        -- Calculate payout per holder (scaled if bankrupt)
        v_payout_amount := v_holder.balance::NUMERIC * v_resolution_price * (v_available_payout / v_total_payout);
        
        UPDATE public.wallets
        SET token_balance = token_balance + v_payout_amount
        WHERE user_id = v_holder.user_id;
        
        INSERT INTO public.ledger_entries (
            wallet_id, amount, currency, operation_type, description
        ) 
        SELECT id, v_payout_amount, 'TOKEN', 'WIN', 'Won bet: ' || v_instrument.title || ' @ ' || round(v_resolution_price, 2)
        FROM public.wallets
        WHERE user_id = v_holder.user_id;
        
        -- Clear Balance
        UPDATE public.user_ticket_balances
        SET balance = 0
        WHERE user_id = v_holder.user_id AND ticket_type_id = v_winning_type_id;
      END LOOP;
  END IF;

  -- Clear Losers
  UPDATE public.user_ticket_balances
  SET balance = 0
  WHERE ticket_type_id = v_losing_type_id;

  -- Update Instrument Status
  UPDATE public.support_instruments
  SET resolution_status = 'RESOLVED',
      winning_side = p_winning_side,
      status = 'RESOLVED',
      deletion_status = 'DELETED_EVERYWHERE' -- Clean up
  WHERE id = p_instrument_id;

  -- 5. Auto-generate Forum Post
  INSERT INTO public.forum_posts (
    title,
    content,
    author_id,
    is_featured,
    created_at
  ) VALUES (
    'Driver Bet Resolved: ' || v_instrument.title,
    'The bet **' || v_instrument.title || '** has been resolved.' || E'\n\n' ||
    '**Winning Side:** ' || v_side_name || E'\n' ||
    '**Resolution Price:** ' || round(v_resolution_price, 2) || ' (Base: ' || round(v_base_price, 2) || ', Market: ' || round(v_final_price, 2) || ')' || E'\n' ||
    '**Proof:** ' || p_proof_url || E'\n\n' ||
    (CASE WHEN v_bankrupt THEN '**Note:** Host went bankrupt during payout.' ELSE '' END),
    v_user_id,
    true, -- Featured
    NOW()
  );

  RETURN jsonb_build_object('success', true, 'message', 'Bet resolved. Price: ' || round(v_resolution_price, 2) || '. Bankrupt: ' || v_bankrupt);
END;
$$;
