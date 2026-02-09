-- 1. Add refund_price to support_instruments
ALTER TABLE public.support_instruments 
ADD COLUMN IF NOT EXISTS refund_price NUMERIC DEFAULT 0.9;

-- 2. Function to Sell Ticket back to Official (Refund)
CREATE OR REPLACE FUNCTION public.sell_ticket_to_official(
  p_instrument_id UUID,
  p_quantity INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_instrument RECORD;
  v_user_ticket_balance INTEGER;
  v_creator_wallet_id UUID;
  v_user_wallet_id UUID;
  v_total_refund_amount NUMERIC;
  v_creator_token_balance NUMERIC;
BEGIN
  -- Get Instrument
  SELECT * INTO v_instrument FROM public.support_instruments WHERE id = p_instrument_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Instrument not found');
  END IF;

  -- Validate Refund Price
  IF v_instrument.refund_price IS NULL OR v_instrument.refund_price <= 0 THEN
     RETURN jsonb_build_object('success', false, 'message', 'Refunds not enabled for this instrument');
  END IF;

  -- Check User Ticket Balance
  SELECT balance INTO v_user_ticket_balance 
  FROM public.user_ticket_balances 
  WHERE user_id = v_user_id AND ticket_type_id = v_instrument.ticket_type_id;

  IF v_user_ticket_balance IS NULL OR v_user_ticket_balance < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient tickets');
  END IF;

  -- Calculate Amount
  v_total_refund_amount := p_quantity * v_instrument.refund_price;

  -- Get Wallets
  SELECT id, token_balance INTO v_creator_wallet_id, v_creator_token_balance 
  FROM public.wallets WHERE user_id = v_instrument.creator_id;
  
  SELECT id INTO v_user_wallet_id FROM public.wallets WHERE user_id = v_user_id;

  -- Check Creator Solvency
  IF v_creator_token_balance < v_total_refund_amount THEN
    RETURN jsonb_build_object('success', false, 'message', 'Official issuer (Creator) has insufficient funds for refund.');
  END IF;

  -- EXECUTE REFUND
  
  -- 1. Transfer Tickets: User -> Creator
  -- Decrease User
  UPDATE public.user_ticket_balances
  SET balance = balance - p_quantity
  WHERE user_id = v_user_id AND ticket_type_id = v_instrument.ticket_type_id;

  -- Increase Creator (Buyback)
  INSERT INTO public.user_ticket_balances (user_id, ticket_type_id, balance)
  VALUES (v_instrument.creator_id, v_instrument.ticket_type_id, p_quantity)
  ON CONFLICT (user_id, ticket_type_id)
  DO UPDATE SET balance = user_ticket_balances.balance + EXCLUDED.balance;

  -- 2. Transfer Tokens: Creator -> User
  -- Decrease Creator
  UPDATE public.wallets
  SET token_balance = token_balance - v_total_refund_amount
  WHERE id = v_creator_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_creator_wallet_id, -v_total_refund_amount, 'TOKEN', 'REFUND_PAYOUT', 'Refund payout for ' || v_instrument.title);

  -- Increase User
  UPDATE public.wallets
  SET token_balance = token_balance + v_total_refund_amount
  WHERE id = v_user_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_user_wallet_id, v_total_refund_amount, 'TOKEN', 'REFUND_RECEIVE', 'Refund received for ' || v_instrument.title);

  RETURN jsonb_build_object('success', true, 'message', 'Tickets sold back to official successfully.');
END;
$$;

-- 3. Update process_deliverable to Pay Interest
CREATE OR REPLACE FUNCTION public.process_deliverable(
    p_deliverable_id UUID,
    p_action TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_is_dev BOOLEAN;
    v_deliverable RECORD;
    v_instrument RECORD;
    v_creator_wallet_id UUID;
    v_creator_token_balance NUMERIC;
    v_total_payout_needed NUMERIC;
    v_holder RECORD;
    v_payout_amount NUMERIC;
    v_count_holders INTEGER := 0;
BEGIN
    -- 1. Check Permissions
    v_user_id := auth.uid();
    
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = v_user_id 
        AND developer_status = 'APPROVED'
    ) INTO v_is_dev;

    IF NOT v_is_dev THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access Denied: Only developers can process deliverables.');
    END IF;

    -- 2. Validate Action
    IF p_action NOT IN ('ISSUE', 'REJECT') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid Action');
    END IF;

    -- 3. Get Deliverable Info
    SELECT * INTO v_deliverable
    FROM public.instrument_deliverables
    WHERE id = p_deliverable_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Deliverable not found');
    END IF;

    IF v_deliverable.status != 'PENDING' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Deliverable is not pending');
    END IF;

    -- 4. Process Action
    IF p_action = 'REJECT' THEN
        -- Simple Reject
        UPDATE public.instrument_deliverables
        SET status = 'REJECTED',
            updated_at = NOW()
        WHERE id = p_deliverable_id;
        
        RETURN jsonb_build_object('success', true, 'message', 'Interest Payment Rejected (Skipped).');
    END IF;

    IF p_action = 'ISSUE' THEN
        -- PAYOUT LOGIC
        
        -- Get Instrument Details
        SELECT * INTO v_instrument FROM public.support_instruments WHERE id = v_deliverable.instrument_id;
        
        -- Get Creator Wallet
        SELECT id, token_balance INTO v_creator_wallet_id, v_creator_token_balance
        FROM public.wallets
        WHERE user_id = v_instrument.creator_id;

        -- Calculate Total Payout Needed
        -- Sum of all user balances (excluding creator himself? usually interest goes to investors)
        -- Let's exclude creator from receiving interest on their own held tickets if they hold any.
        SELECT COALESCE(SUM(balance), 0) * v_instrument.deliverable_cost_per_ticket 
        INTO v_total_payout_needed
        FROM public.user_ticket_balances
        WHERE ticket_type_id = v_instrument.ticket_type_id
        AND user_id != v_instrument.creator_id -- Exclude creator
        AND balance > 0;

        IF v_total_payout_needed = 0 THEN
             -- No holders to pay, just mark done
             UPDATE public.instrument_deliverables
             SET status = 'ISSUED', updated_at = NOW()
             WHERE id = p_deliverable_id;
             RETURN jsonb_build_object('success', true, 'message', 'Marked Issued (No holders to pay).');
        END IF;

        -- Check Solvency
        IF v_creator_token_balance < v_total_payout_needed THEN
            RETURN jsonb_build_object('success', false, 'message', 'Insufficient funds to pay interest. Required: ' || v_total_payout_needed || ', Available: ' || v_creator_token_balance);
        END IF;

        -- Execute Payouts
        -- Deduct from Creator
        UPDATE public.wallets
        SET token_balance = token_balance - v_total_payout_needed
        WHERE id = v_creator_wallet_id;
        
        INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
        VALUES (v_creator_wallet_id, -v_total_payout_needed, 'TOKEN', 'INTEREST_PAYOUT', 'Interest payout for ' || v_instrument.title);

        -- Distribute to Holders
        FOR v_holder IN 
            SELECT user_id, balance 
            FROM public.user_ticket_balances 
            WHERE ticket_type_id = v_instrument.ticket_type_id
            AND user_id != v_instrument.creator_id
            AND balance > 0
        LOOP
            v_payout_amount := v_holder.balance * v_instrument.deliverable_cost_per_ticket;
            
            -- Credit User
            UPDATE public.wallets
            SET token_balance = token_balance + v_payout_amount
            WHERE user_id = v_holder.user_id;
            
            INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
            SELECT id, v_payout_amount, 'TOKEN', 'INTEREST_RECEIVE', 'Interest received from ' || v_instrument.title
            FROM public.wallets
            WHERE user_id = v_holder.user_id;
            
            v_count_holders := v_count_holders + 1;
        END LOOP;

        -- Mark as ISSUED
        UPDATE public.instrument_deliverables
        SET status = 'ISSUED',
            updated_at = NOW()
        WHERE id = p_deliverable_id;
        
        RETURN jsonb_build_object('success', true, 'message', 'Interest Paid Successfully to ' || v_count_holders || ' holders. Total: ' || v_total_payout_needed);
    END IF;

    RETURN jsonb_build_object('success', false, 'message', 'Unexpected Error');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
