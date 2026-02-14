-- Fix Driver Bet Resolution:
-- 1. Enforce Release Date (open_date)
-- 2. Require Proof URL
-- 3. Auto-generate Forum Post

DROP FUNCTION IF EXISTS public.resolve_driver_bet(UUID, TEXT);

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
  
  v_total_pool NUMERIC;
  v_winning_ticket_count INTEGER;
  v_payout_per_ticket NUMERIC;
  
  v_winning_type_id UUID;
  v_losing_type_id UUID;
  
  v_holder RECORD;
  v_payout_amount NUMERIC;
  v_host_balance NUMERIC;
  v_bankrupt BOOLEAN := false;
  v_available_payout NUMERIC;
  v_side_name TEXT;
  
  v_total_a INTEGER;
  v_total_b INTEGER;
  v_total_sold INTEGER;
  v_base NUMERIC;
  v_flex NUMERIC;
  v_limit INTEGER;
  v_open TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_total_interval NUMERIC;
  v_time_factor NUMERIC;
  v_demand_ratio NUMERIC;
  v_resolution_price NUMERIC;
  v_total_payout NUMERIC;
BEGIN
  -- Get Instrument
  SELECT * INTO v_instrument FROM public.support_instruments WHERE id = p_instrument_id;
  v_creator_user_id := v_instrument.creator_id;
  
  IF NOT FOUND OR NOT v_instrument.is_driver_bet THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid instrument');
  END IF;

  -- CHECK 1: Release Date
  -- The 'open_date' is the Result Release Date
  IF NOW() < v_instrument.open_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cannot release result before Release Date (' || v_instrument.open_date || ')');
  END IF;

  -- CHECK 2: Proof URL
  IF p_proof_url IS NULL OR length(trim(p_proof_url)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Proof URL is required (e.g. F1 Official Website)');
  END IF;
  
  -- Check Authority
  SELECT developer_status INTO v_developer_status FROM public.profiles WHERE id = v_user_id;
  SELECT reputation_balance INTO v_creator_rep FROM public.wallets WHERE user_id = v_user_id;
  
  -- Logic: Rep 70+ or Dev can resolve
  IF v_developer_status != 'APPROVED' AND v_creator_rep < 70 THEN
     RETURN jsonb_build_object('success', false, 'message', 'Insufficient authority to resolve. Rep > 70 or Developer status required.');
  END IF;

  -- Totals
  SELECT COALESCE(SUM(balance), 0) INTO v_total_a FROM public.user_ticket_balances WHERE ticket_type_id = v_instrument.ticket_type_a_id;
  SELECT COALESCE(SUM(balance), 0) INTO v_total_b FROM public.user_ticket_balances WHERE ticket_type_id = v_instrument.ticket_type_b_id;
  v_total_sold := v_total_a + v_total_b;
  
  IF p_winning_side = 'A' THEN
      v_winning_ticket_count := v_total_a;
      v_winning_type_id := v_instrument.ticket_type_a_id;
      v_losing_type_id := v_instrument.ticket_type_b_id;
      v_side_name := v_instrument.side_a_name;
  ELSE
      v_winning_ticket_count := v_total_b;
      v_winning_type_id := v_instrument.ticket_type_b_id;
      v_losing_type_id := v_instrument.ticket_type_a_id;
      v_side_name := v_instrument.side_b_name;
  END IF;
  
  -- Resolution Price Policy: Current price at ending date (no noise)
  v_base := COALESCE(v_instrument.ticket_price, 1.0);
  v_flex := COALESCE(v_instrument.dynamic_flex_pct, 0);
  v_limit := COALESCE(v_instrument.ticket_limit, 0);
  v_open := COALESCE(v_instrument.open_date, v_instrument.created_at);
  v_end := COALESCE(v_instrument.official_end_date, v_open);
  IF v_end <= v_open THEN
    v_total_interval := 1;
  ELSE
    v_total_interval := EXTRACT(EPOCH FROM (v_end - v_open));
  END IF;
  v_time_factor := CASE WHEN v_total_interval = 0 THEN 0 ELSE 1 END;
  IF v_limit IS NULL OR v_limit = 0 THEN
    v_demand_ratio := 0;
  ELSE
    v_demand_ratio := GREATEST(0, LEAST(1, (v_total_sold::NUMERIC / v_limit::NUMERIC)));
  END IF;
  v_resolution_price := v_base * (1 + v_flex * ((0.5 * v_time_factor + 0.5 * v_demand_ratio) - 0.5));
  IF v_resolution_price < 0.1 THEN
    v_resolution_price := 0.1;
  END IF;
  
  v_total_payout := v_winning_ticket_count::NUMERIC * v_resolution_price;

  IF v_winning_ticket_count = 0 THEN
    -- Edge case: No winning tickets sold.
    -- We still resolve the market, but nobody gets paid.
    -- Host keeps the money from losers? Or refund?
    -- In Pari-Mutuel, if nobody wins, usually house keeps or refund.
    -- Let's just proceed to close it.
    v_payout_per_ticket := 0;
  ELSE
    v_payout_per_ticket := v_resolution_price;
  END IF;

  -- Check Host Solvency
  SELECT id, token_balance INTO v_creator_wallet_id, v_host_balance 
  FROM public.wallets WHERE user_id = v_creator_user_id;

  -- If there are winners, we need to pay them
  IF v_winning_ticket_count > 0 THEN
      IF v_host_balance < v_total_payout THEN
        v_bankrupt := true;
        v_available_payout := v_host_balance; -- All they have
        
        -- Penalty
        UPDATE public.wallets 
        SET reputation_balance = reputation_balance - 10,
            token_balance = 0 -- Take everything
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
        v_payout_amount := v_holder.balance::NUMERIC * v_payout_per_ticket * (v_available_payout / v_total_payout);
        
        UPDATE public.wallets
        SET token_balance = token_balance + v_payout_amount
        WHERE user_id = v_holder.user_id;
        
        INSERT INTO public.ledger_entries (
            wallet_id, amount, currency, operation_type, description
        ) 
        SELECT id, v_payout_amount, 'TOKEN', 'WIN', 'Won bet: ' || v_instrument.title
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
      deletion_status = 'DELETED_EVERYWHERE'
  WHERE id = p_instrument_id;

  -- 3. Auto-generate Forum Post
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
    '**Proof:** ' || p_proof_url || E'\n\n' ||
    (CASE WHEN v_bankrupt THEN '**Note:** Host went bankrupt during payout.' ELSE '' END),
    v_user_id,
    true, -- Featured
    NOW()
  );

  RETURN jsonb_build_object('success', true, 'message', 'Bet resolved and posted to forum. Bankrupt: ' || v_bankrupt);
END;
$$;
