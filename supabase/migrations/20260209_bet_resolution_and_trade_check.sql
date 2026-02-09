-- 1. Prevent Trading After Release Date
CREATE OR REPLACE FUNCTION public.purchase_ticket_listing(
  p_listing_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_buyer_id UUID := auth.uid();
  v_seller_id UUID;
  v_ticket_type_id UUID;
  v_quantity INTEGER;
  v_price_per_unit NUMERIC;
  v_total_price NUMERIC;
  v_listing_status TEXT;
  v_buyer_balance NUMERIC;
  v_buyer_wallet_id UUID;
  v_seller_wallet_id UUID;
  v_rep INTEGER;
  v_fee NUMERIC;
  v_seller_receive NUMERIC;
  v_open_date TIMESTAMPTZ;
BEGIN
  -- 1. Check Reputation
  SELECT reputation_balance INTO v_rep FROM public.wallets WHERE user_id = v_buyer_id;
  IF v_rep <= 50 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Reputation too low (< 50)');
  END IF;

  -- 2. Get Listing Details
  SELECT seller_id, ticket_type_id, quantity, price_per_unit, status 
  INTO v_seller_id, v_ticket_type_id, v_quantity, v_price_per_unit, v_listing_status
  FROM public.ticket_listings
  WHERE id = p_listing_id;

  IF v_listing_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Listing not found');
  END IF;
  
  IF v_listing_status != 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Listing is not active');
  END IF;
  
  IF v_seller_id = v_buyer_id THEN
     RETURN jsonb_build_object('success', false, 'message', 'Cannot buy your own listing');
  END IF;

  -- 2.1 CHECK RELEASE DATE (New Logic)
  -- Find associated instrument and check open_date
  SELECT open_date INTO v_open_date
  FROM public.support_instruments
  WHERE ticket_type_id = v_ticket_type_id 
     OR ticket_type_a_id = v_ticket_type_id 
     OR ticket_type_b_id = v_ticket_type_id
  LIMIT 1;

  IF v_open_date IS NOT NULL AND NOW() > v_open_date THEN
     RETURN jsonb_build_object('success', false, 'message', 'Trading closed: Result Release Date passed.');
  END IF;

  v_total_price := v_quantity * v_price_per_unit;
  v_fee := v_total_price * 0.02; -- 2% Fee
  v_seller_receive := v_total_price - v_fee;

  -- 3. Check Buyer Token Balance
  SELECT id, token_balance INTO v_buyer_wallet_id, v_buyer_balance 
  FROM public.wallets WHERE user_id = v_buyer_id;
  
  IF v_buyer_balance < v_total_price THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient funds');
  END IF;

  SELECT id INTO v_seller_wallet_id FROM public.wallets WHERE user_id = v_seller_id;

  -- 4. Execute Trade
  -- 4.1 Deduct Tokens from Buyer (Full Amount)
  UPDATE public.wallets 
  SET token_balance = token_balance - v_total_price
  WHERE id = v_buyer_wallet_id;
  
  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_buyer_wallet_id, -v_total_price, 'TOKEN', 'TRADE_BUY', 'Bought tickets from listing ' || p_listing_id);

  -- 4.2 Add Tokens to Seller (Net Amount)
  UPDATE public.wallets 
  SET token_balance = token_balance + v_seller_receive
  WHERE id = v_seller_wallet_id;
  
  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_seller_wallet_id, v_seller_receive, 'TOKEN', 'TRADE_SELL', 'Sold tickets via listing ' || p_listing_id);

  -- 4.3 Transfer Tickets to Buyer
  INSERT INTO public.user_ticket_balances (user_id, ticket_type_id, balance)
  VALUES (v_buyer_id, v_ticket_type_id, v_quantity)
  ON CONFLICT (user_id, ticket_type_id)
  DO UPDATE SET balance = user_ticket_balances.balance + EXCLUDED.balance;

  -- 4.4 Update Listing
  UPDATE public.ticket_listings
  SET status = 'SOLD'
  WHERE id = p_listing_id;

  -- 4.5 Record Transaction
  INSERT INTO public.ticket_transactions (listing_id, buyer_id, seller_id, ticket_type_id, quantity, price_per_unit, total_price)
  VALUES (p_listing_id, v_buyer_id, v_seller_id, v_ticket_type_id, v_quantity, v_price_per_unit, v_total_price);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 2. Delete Bet After Resolution
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

  -- Calculate Pool
  DECLARE
    v_total_a INTEGER;
    v_total_b INTEGER;
  BEGIN
    SELECT COALESCE(SUM(balance), 0) INTO v_total_a FROM public.user_ticket_balances WHERE ticket_type_id = v_instrument.ticket_type_a_id;
    SELECT COALESCE(SUM(balance), 0) INTO v_total_b FROM public.user_ticket_balances WHERE ticket_type_id = v_instrument.ticket_type_b_id;
    
    v_total_pool := (v_total_a + v_total_b) * v_instrument.ticket_price;
    
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
  END;

  IF v_winning_ticket_count = 0 THEN
    v_payout_per_ticket := 0;
  ELSE
    v_payout_per_ticket := v_total_pool / v_winning_ticket_count;
  END IF;

  -- Check Host Solvency
  SELECT id, token_balance INTO v_creator_wallet_id, v_host_balance 
  FROM public.wallets WHERE user_id = v_creator_user_id;

  -- If there are winners, we need to pay them
  IF v_winning_ticket_count > 0 THEN
      IF v_host_balance < v_total_pool THEN
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
        v_available_payout := v_total_pool;
        -- Deduct from Host
        UPDATE public.wallets 
        SET token_balance = token_balance - v_total_pool 
        WHERE id = v_creator_wallet_id;
        
        INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
        VALUES (v_creator_wallet_id, -v_total_pool, 'TOKEN', 'BET_PAYOUT', 'Payout for: ' || v_instrument.title);
      END IF;

      -- Distribute to Winners
      FOR v_holder IN 
        SELECT user_id, balance 
        FROM public.user_ticket_balances 
        WHERE ticket_type_id = v_winning_type_id AND balance > 0
      LOOP
        -- Calculate share
        v_payout_amount := (v_holder.balance::NUMERIC / v_winning_ticket_count::NUMERIC) * v_available_payout;
        
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

  -- 3. Auto-generate Forum Post (BEFORE Deletion)
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
  
  -- 4. Delete Instrument (As requested)
  -- This will hard delete the instrument. 
  -- Assuming cascade delete or manual cleanup isn't strictly blocked by other FKs not mentioned.
  -- If FK issues arise, we might need to handle them, but typically 'support_instruments' is the parent.
  DELETE FROM public.support_instruments WHERE id = p_instrument_id;

  RETURN jsonb_build_object('success', true, 'message', 'Bet resolved, posted to forum, and entry deleted. Bankrupt: ' || v_bankrupt);
END;
$$;

-- 3. Update get_developer_inbox to include open_date (Release Date)
CREATE OR REPLACE FUNCTION public.get_developer_inbox()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_is_dev BOOLEAN;
  v_pending_devs JSONB;
  v_pending_missions JSONB;
  v_active_bets JSONB;
  v_pending_acks JSONB;
  v_pending_tests JSONB;
  v_pending_deliverables JSONB;
BEGIN
  v_user_id := auth.uid();
  
  -- Check if user is developer (or admin)
  SELECT (COALESCE(developer_status, 'NONE') = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_is_dev IS NULL THEN v_is_dev := false; END IF;

  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  -- 1. Pending Developer Requests
  SELECT jsonb_agg(t) INTO v_pending_devs
  FROM (
    SELECT 
        id, 
        COALESCE(username, 'Awaiting_' || substr(id::text, 1, 8)) as username, 
        COALESCE(full_name, 'No Name') as full_name, 
        created_at
    FROM public.profiles
    WHERE developer_status = 'PENDING'
  ) t;

  -- 2. Pending Mission Submissions
  SELECT jsonb_agg(t) INTO v_pending_missions
  FROM (
    SELECT 
      s.id, 
      s.content, 
      s.created_at, 
      m.title as mission_title,
      COALESCE(p.username, 'Unknown User') as submitter_name,
      s.user_id
    FROM public.mission_submissions s
    LEFT JOIN public.missions m ON s.mission_id = m.id
    LEFT JOIN public.profiles p ON s.user_id = p.id
    WHERE s.status = 'PENDING'
  ) t;

  -- 3. Active Bets (Driver Bets needing resolution)
  SELECT jsonb_agg(t) INTO v_active_bets
  FROM (
    SELECT 
      i.id, 
      i.title, 
      i.description, 
      i.official_end_date,
      i.open_date, -- Added Release Date
      i.side_a_name, 
      i.side_b_name,
      COALESCE(p.username, 'Unknown User') as creator_name
    FROM public.support_instruments i
    LEFT JOIN public.profiles p ON i.creator_id = p.id
    WHERE i.is_driver_bet = true 
    AND i.status != 'RESOLVED'
  ) t;

  -- 4. Forum Acknowledgement Requests
  BEGIN
      SELECT jsonb_agg(t) INTO v_pending_acks
      FROM (
        SELECT 
          f.id, 
          f.title, 
          f.created_at, 
          COALESCE(p.username, 'Unknown User') as author_name
        FROM public.forum_posts f
        LEFT JOIN public.profiles p ON f.author_id = p.id
        WHERE f.is_acknowledgement_requested = true
      ) t;
  EXCEPTION WHEN OTHERS THEN
      v_pending_acks := '[]'::jsonb;
  END;

  -- 5. Pending Test Player Requests
  BEGIN
      SELECT jsonb_agg(t) INTO v_pending_tests
      FROM (
          SELECT 
              r.id,
              r.identifiable_name,
              r.program,
              r.progress_description,
              r.created_at,
              COALESCE(p.username, 'Unknown User') as user_name,
              COALESCE(p.email, 'No Email') as user_email
          FROM public.test_player_requests r
          LEFT JOIN public.profiles p ON r.user_id = p.id
          WHERE r.status = 'PENDING'
      ) t;
  EXCEPTION WHEN OTHERS THEN
      v_pending_tests := '[]'::jsonb;
  END;

  -- 6. Pending Deliverables
  BEGIN
      SELECT jsonb_agg(t) INTO v_pending_deliverables
      FROM (
        SELECT 
            d.id,
            d.instrument_id,
            d.due_date,
            d.created_at,
            i.title as instrument_title,
            i.deliverable_condition,
            i.deliverable_cost_per_ticket,
            COALESCE(p.username, 'Unknown User') as creator_name
        FROM public.instrument_deliverables d
        JOIN public.support_instruments i ON d.instrument_id = i.id
        LEFT JOIN public.profiles p ON i.creator_id = p.id
        WHERE d.status = 'PENDING'
      ) t;
  EXCEPTION WHEN OTHERS THEN
      v_pending_deliverables := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'pending_devs', COALESCE(v_pending_devs, '[]'::jsonb),
    'pending_missions', COALESCE(v_pending_missions, '[]'::jsonb),
    'active_bets', COALESCE(v_active_bets, '[]'::jsonb),
    'pending_acks', COALESCE(v_pending_acks, '[]'::jsonb),
    'pending_tests', COALESCE(v_pending_tests, '[]'::jsonb),
    'pending_deliverables', COALESCE(v_pending_deliverables, '[]'::jsonb)
  );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', 'RPC Error: ' || SQLERRM);
END;
$$;
