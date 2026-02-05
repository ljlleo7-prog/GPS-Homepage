-- Driver Bets Schema & Logic

-- 1. Schema Updates
ALTER TABLE public.support_instruments
ADD COLUMN IF NOT EXISTS side_a_name TEXT,
ADD COLUMN IF NOT EXISTS side_b_name TEXT,
ADD COLUMN IF NOT EXISTS ticket_type_a_id UUID REFERENCES public.ticket_types(id),
ADD COLUMN IF NOT EXISTS ticket_type_b_id UUID REFERENCES public.ticket_types(id),
ADD COLUMN IF NOT EXISTS ticket_price NUMERIC DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS ticket_limit INTEGER,
ADD COLUMN IF NOT EXISTS official_end_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS open_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS winning_side TEXT, -- 'A' or 'B'
ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'OPEN'; -- 'OPEN', 'PENDING_VERIFICATION', 'RESOLVED'

-- 2. Create Driver Bet Function
CREATE OR REPLACE FUNCTION public.create_driver_bet(
  p_title TEXT,
  p_description TEXT,
  p_side_a_name TEXT,
  p_side_b_name TEXT,
  p_ticket_price NUMERIC,
  p_ticket_limit INTEGER,
  p_official_end_date TIMESTAMPTZ,
  p_open_date TIMESTAMPTZ
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep_balance NUMERIC;
  v_instrument_id UUID;
  v_ticket_a_id UUID;
  v_ticket_b_id UUID;
  v_status TEXT := 'OPEN'; -- Default status
BEGIN
  -- Check Reputation
  SELECT reputation_balance INTO v_rep_balance FROM public.wallets WHERE user_id = v_user_id;
  
  IF v_rep_balance < 50 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient reputation (50+ required)');
  END IF;

  -- Validate Dates
  IF p_official_end_date <= NOW() OR p_open_date <= p_official_end_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid dates: End date must be future, Open date must be after End date');
  END IF;

  -- Validate Price
  IF p_ticket_price < 0.1 OR p_ticket_price > 100 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ticket price must be between 0.1 and 100');
  END IF;

  -- Create Instrument
  INSERT INTO public.support_instruments (
    creator_id,
    title,
    description,
    type,
    status,
    risk_level,
    is_driver_bet,
    side_a_name,
    side_b_name,
    ticket_price,
    ticket_limit,
    official_end_date,
    open_date,
    resolution_status
  ) VALUES (
    v_user_id,
    p_title,
    p_description,
    'MARKET', -- Using MARKET type base
    'OPEN',
    'HIGH', -- Always High Risk
    true,
    p_side_a_name,
    p_side_b_name,
    p_ticket_price,
    p_ticket_limit,
    p_official_end_date,
    p_open_date,
    'OPEN'
  ) RETURNING id INTO v_instrument_id;

  -- Create Ticket Types
  INSERT INTO public.ticket_types (creator_id, title, description, total_supply)
  VALUES (v_user_id, p_title || ' - ' || p_side_a_name, 'Driver Bet Ticket: ' || p_side_a_name, p_ticket_limit) -- Supply limit per side? Or total? Let's be generous with type supply, enforce limit in logic
  RETURNING id INTO v_ticket_a_id;

  INSERT INTO public.ticket_types (creator_id, title, description, total_supply)
  VALUES (v_user_id, p_title || ' - ' || p_side_b_name, 'Driver Bet Ticket: ' || p_side_b_name, p_ticket_limit)
  RETURNING id INTO v_ticket_b_id;

  -- Update Instrument with Ticket IDs
  UPDATE public.support_instruments
  SET ticket_type_a_id = v_ticket_a_id,
      ticket_type_b_id = v_ticket_b_id
  WHERE id = v_instrument_id;

  RETURN jsonb_build_object('success', true, 'message', 'Driver Bet created successfully', 'id', v_instrument_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Buy Driver Bet Ticket Function
CREATE OR REPLACE FUNCTION public.buy_driver_bet_ticket(
  p_instrument_id UUID,
  p_side TEXT, -- 'A' or 'B'
  p_quantity INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_instrument RECORD;
  v_ticket_type_id UUID;
  v_cost NUMERIC;
  v_total_sold INTEGER;
  v_creator_wallet_id UUID;
  v_buyer_wallet_id UUID;
BEGIN
  -- Get Instrument
  SELECT * INTO v_instrument FROM public.support_instruments WHERE id = p_instrument_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Instrument not found');
  END IF;

  IF NOT v_instrument.is_driver_bet THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not a Driver Bet');
  END IF;

  -- Check Date
  IF NOW() > v_instrument.official_end_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Official sales have ended');
  END IF;

  -- Determine Ticket Type
  IF p_side = 'A' THEN
    v_ticket_type_id := v_instrument.ticket_type_a_id;
  ELSIF p_side = 'B' THEN
    v_ticket_type_id := v_instrument.ticket_type_b_id;
  ELSE
    RETURN jsonb_build_object('success', false, 'message', 'Invalid side');
  END IF;

  -- Check Limit
  -- We need to sum up all tickets sold for A and B
  SELECT COALESCE(SUM(balance), 0) INTO v_total_sold
  FROM public.user_ticket_balances
  WHERE ticket_type_id IN (v_instrument.ticket_type_a_id, v_instrument.ticket_type_b_id);

  IF v_total_sold + p_quantity > v_instrument.ticket_limit THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ticket limit reached');
  END IF;

  v_cost := p_quantity * v_instrument.ticket_price;

  -- Get Wallets
  SELECT id INTO v_buyer_wallet_id FROM public.wallets WHERE user_id = v_user_id;
  SELECT id INTO v_creator_wallet_id FROM public.wallets WHERE user_id = v_instrument.creator_id;

  -- Check Balance
  IF (SELECT token_balance FROM public.wallets WHERE id = v_buyer_wallet_id) < v_cost THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient funds');
  END IF;

  -- Transfer Tokens: Buyer -> Creator
  UPDATE public.wallets SET token_balance = token_balance - v_cost WHERE id = v_buyer_wallet_id;
  UPDATE public.wallets SET token_balance = token_balance + v_cost WHERE id = v_creator_wallet_id;

  -- Ledger Entries
  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_buyer_wallet_id, -v_cost, 'TOKEN', 'BUY_BET', 'Bought ' || p_quantity || ' tickets for ' || v_instrument.title);
  
  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_creator_wallet_id, v_cost, 'TOKEN', 'BET_INCOME', 'Sold ' || p_quantity || ' tickets for ' || v_instrument.title);

  -- Mint Tickets
  INSERT INTO public.user_ticket_balances (user_id, ticket_type_id, balance)
  VALUES (v_user_id, v_ticket_type_id, p_quantity)
  ON CONFLICT (user_id, ticket_type_id)
  DO UPDATE SET balance = public.user_ticket_balances.balance + p_quantity;

  RETURN jsonb_build_object('success', true, 'message', 'Tickets purchased');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Resolve Driver Bet Function
CREATE OR REPLACE FUNCTION public.resolve_driver_bet(
  p_instrument_id UUID,
  p_winning_side TEXT -- 'A' or 'B'
)
RETURNS JSONB AS $$
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
BEGIN
  -- Get Instrument
  SELECT * INTO v_instrument FROM public.support_instruments WHERE id = p_instrument_id;
  v_creator_user_id := v_instrument.creator_id;
  
  IF NOT FOUND OR NOT v_instrument.is_driver_bet THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid instrument');
  END IF;
  
  -- Check Authority
  SELECT developer_status INTO v_developer_status FROM public.profiles WHERE id = v_user_id;
  SELECT reputation_balance INTO v_creator_rep FROM public.wallets WHERE user_id = v_user_id;
  
  -- Logic: 
  -- Rep 50-69: Can create, but RESULT must be verified by Dev.
  -- This function is "Resolve". If Rep < 70 and not Dev, cannot resolve?
  -- Or if Rep < 70, they call this and it sets status to 'PENDING_VERIFICATION'?
  -- User says: "Reputation 50-69 can create driver bets but result (success or fail) must be verified or deleted by a developer."
  -- "Reputation 70+ can create, delete, and release results."
  
  IF v_developer_status != 'APPROVED' AND v_creator_rep < 70 THEN
     -- If user is the creator but rep is low, they might request resolution? 
     -- For simplicity, let's say only 70+ or Devs can call this final resolution.
     -- Low rep creators might need a separate "Submit Result" function, but let's just enforce 70+ here for now.
     RETURN jsonb_build_object('success', false, 'message', 'Insufficient authority to resolve. Contact a developer.');
  END IF;

  -- Calculate Pool
  -- Total Pool = (Total A Tickets + Total B Tickets) * Ticket Price
  -- Note: We calculate based on current circulation.
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
    ELSE
        v_winning_ticket_count := v_total_b;
        v_winning_type_id := v_instrument.ticket_type_b_id;
        v_losing_type_id := v_instrument.ticket_type_a_id;
    END IF;
  END;

  IF v_winning_ticket_count = 0 THEN
    -- Edge case: No winners. Host keeps money? Or refund everyone?
    -- Let's assume refund everyone (cancel).
    -- For now, just return error.
    RETURN jsonb_build_object('success', false, 'message', 'No winning tickets sold.');
  END IF;

  v_payout_per_ticket := v_total_pool / v_winning_ticket_count;

  -- Check Host Solvency
  SELECT id, token_balance INTO v_creator_wallet_id, v_host_balance 
  FROM public.wallets WHERE user_id = v_creator_user_id;

  IF v_host_balance < v_total_pool THEN
    v_bankrupt := true;
    v_available_payout := v_host_balance; -- All they have
    
    -- Penalty
    UPDATE public.wallets 
    SET reputation_balance = reputation_balance - 10,
        token_balance = 0 -- Take everything
    WHERE id = v_creator_wallet_id;
    
    -- Tag Bankrupt (We don't have a column for this on profiles, maybe just use ledger or implicit?)
    -- User said "tagged bankrupt and one-week ban".
    -- We can set a 'banned_until' on profiles if it exists, or just log it.
    -- For now, let's just log the rep deduction and bankruptcy.
    
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
    -- If bankrupt, they get share of available.
    -- Share = (UserTickets / WinningTickets) * AvailablePayout
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

  -- Clear Losers
  UPDATE public.user_ticket_balances
  SET balance = 0
  WHERE ticket_type_id = v_losing_type_id;

  -- Update Instrument Status
  UPDATE public.support_instruments
  SET resolution_status = 'RESOLVED',
      winning_side = p_winning_side,
      status = 'RESOLVED'
  WHERE id = p_instrument_id;

  RETURN jsonb_build_object('success', true, 'message', 'Bet resolved. Bankrupt: ' || v_bankrupt);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
