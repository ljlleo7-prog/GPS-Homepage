-- Developer Pool Economics Adjustments
-- 1) Split anonymous instrument sales income equally among developers
-- 2) Split refund costs and interest costs equally among developers
-- 3) Adjust legacy AI instruments interest from 5.00 to 0.025 TKN per ticket

-- 1. Adjust Legacy Instruments Interest Level
DO $$
BEGIN
  UPDATE public.support_instruments
  SET deliverable_cost_per_ticket = 0.025
  WHERE (is_driver_bet IS FALSE OR is_driver_bet IS NULL)
    AND deliverable_cost_per_ticket = 5.00;
END $$;

-- 2. BUY CAMPAIGN TICKET: route income to developer pool
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

-- 3. SELL TICKET TO OFFICIAL: refund cost from developer pool
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
  v_user_wallet_id UUID;
  v_total_refund_amount NUMERIC;
  v_dev_count INTEGER;
  v_share_per_dev NUMERIC;
  v_min_dev_balance NUMERIC;
BEGIN
  SELECT * INTO v_instrument FROM public.support_instruments WHERE id = p_instrument_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Instrument not found');
  END IF;

  IF v_instrument.refund_price IS NULL OR v_instrument.refund_price <= 0 THEN
     RETURN jsonb_build_object('success', false, 'message', 'Refunds not enabled for this instrument');
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
     RETURN jsonb_build_object('success', false, 'message', 'Invalid quantity');
  END IF;

  SELECT balance INTO v_user_ticket_balance 
  FROM public.user_ticket_balances 
  WHERE user_id = v_user_id AND ticket_type_id = v_instrument.ticket_type_id;

  IF v_user_ticket_balance IS NULL OR v_user_ticket_balance < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient tickets');
  END IF;

  v_total_refund_amount := p_quantity * v_instrument.refund_price;

  SELECT id INTO v_user_wallet_id FROM public.wallets WHERE user_id = v_user_id;

  SELECT COUNT(*), MIN(w.token_balance)
  INTO v_dev_count, v_min_dev_balance
  FROM public.wallets w
  JOIN public.profiles p ON w.user_id = p.id
  WHERE p.developer_status = 'APPROVED';

  IF v_dev_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'No developers available for refund pool');
  END IF;

  v_share_per_dev := v_total_refund_amount / v_dev_count;

  IF v_min_dev_balance IS NULL OR v_min_dev_balance < v_share_per_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Developer pool has insufficient funds for refund.');
  END IF;

  UPDATE public.user_ticket_balances
  SET balance = balance - p_quantity
  WHERE user_id = v_user_id AND ticket_type_id = v_instrument.ticket_type_id;

  INSERT INTO public.user_ticket_balances (user_id, ticket_type_id, balance)
  VALUES (v_instrument.creator_id, v_instrument.ticket_type_id, p_quantity)
  ON CONFLICT (user_id, ticket_type_id)
  DO UPDATE SET balance = user_ticket_balances.balance + EXCLUDED.balance;

  UPDATE public.wallets w
  SET token_balance = token_balance - v_share_per_dev
  WHERE w.user_id IN (SELECT id FROM public.profiles WHERE developer_status = 'APPROVED');

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  SELECT w.id, -v_share_per_dev, 'TOKEN', 'REFUND_POOL_COST', 'Refund cost for anonymous instrument'
  FROM public.wallets w
  JOIN public.profiles p ON w.user_id = p.id
  WHERE p.developer_status = 'APPROVED';

  UPDATE public.wallets
  SET token_balance = token_balance + v_total_refund_amount
  WHERE id = v_user_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_user_wallet_id, v_total_refund_amount, 'TOKEN', 'REFUND_RECEIVE', 'Refund received for ' || v_instrument.title);

  INSERT INTO public.official_price_history (instrument_id, ticket_type_id, price)
  VALUES (p_instrument_id, v_instrument.ticket_type_id, public.get_official_price_by_ticket_type(v_instrument.ticket_type_id));

  RETURN jsonb_build_object('success', true, 'message', 'Tickets sold back to official successfully.');
END;
$$;

-- 4. PROCESS DELIVERABLE: pay interest from developer pool
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
    v_total_payout_needed NUMERIC;
    v_holder RECORD;
    v_payout_amount NUMERIC;
    v_count_holders INTEGER := 0;
    v_dev_count INTEGER;
    v_min_dev_balance NUMERIC;
    v_share_per_dev NUMERIC;
BEGIN
    v_user_id := auth.uid();
    
    SELECT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = v_user_id 
        AND developer_status = 'APPROVED'
    ) INTO v_is_dev;

    IF NOT v_is_dev THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access Denied: Only developers can process deliverables.');
    END IF;

    IF p_action NOT IN ('ISSUE', 'REJECT') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid Action');
    END IF;

    SELECT * INTO v_deliverable
    FROM public.instrument_deliverables
    WHERE id = p_deliverable_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Deliverable not found');
    END IF;

    IF v_deliverable.status != 'PENDING' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Deliverable is not pending');
    END IF;

    IF p_action = 'REJECT' THEN
        UPDATE public.instrument_deliverables
        SET status = 'REJECTED',
            updated_at = NOW()
        WHERE id = p_deliverable_id;
        
        RETURN jsonb_build_object('success', true, 'message', 'Interest Payment Rejected (Skipped).');
    END IF;

    IF p_action = 'ISSUE' THEN
        SELECT * INTO v_instrument FROM public.support_instruments WHERE id = v_deliverable.instrument_id;
        
        SELECT COALESCE(SUM(balance), 0) * v_instrument.deliverable_cost_per_ticket 
        INTO v_total_payout_needed
        FROM public.user_ticket_balances
        WHERE ticket_type_id = v_instrument.ticket_type_id
        AND user_id != v_instrument.creator_id
        AND balance > 0;

        IF v_total_payout_needed = 0 THEN
             UPDATE public.instrument_deliverables
             SET status = 'ISSUED', updated_at = NOW()
             WHERE id = p_deliverable_id;
             RETURN jsonb_build_object('success', true, 'message', 'Marked Issued (No holders to pay).');
        END IF;

        SELECT COUNT(*), MIN(w.token_balance)
        INTO v_dev_count, v_min_dev_balance
        FROM public.wallets w
        JOIN public.profiles p ON w.user_id = p.id
        WHERE p.developer_status = 'APPROVED';

        IF v_dev_count = 0 THEN
            RETURN jsonb_build_object('success', false, 'message', 'No developers available for interest pool.');
        END IF;

        v_share_per_dev := v_total_payout_needed / v_dev_count;

        IF v_min_dev_balance IS NULL OR v_min_dev_balance < v_share_per_dev THEN
            RETURN jsonb_build_object('success', false, 'message', 'Developer pool has insufficient funds to pay interest.');
        END IF;

        UPDATE public.wallets w
        SET token_balance = token_balance - v_share_per_dev
        WHERE w.user_id IN (SELECT id FROM public.profiles WHERE developer_status = 'APPROVED');
        
        INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
        SELECT w.id, -v_share_per_dev, 'TOKEN', 'INTEREST_POOL_COST', 'Interest payout pool for ' || v_instrument.title
        FROM public.wallets w
        JOIN public.profiles p ON w.user_id = p.id
        WHERE p.developer_status = 'APPROVED';

        FOR v_holder IN 
            SELECT user_id, balance 
            FROM public.user_ticket_balances 
            WHERE ticket_type_id = v_instrument.ticket_type_id
            AND user_id != v_instrument.creator_id
            AND balance > 0
        LOOP
            v_payout_amount := v_holder.balance * v_instrument.deliverable_cost_per_ticket;
            
            UPDATE public.wallets
            SET token_balance = token_balance + v_payout_amount
            WHERE user_id = v_holder.user_id;
            
            INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
            SELECT id, v_payout_amount, 'TOKEN', 'INTEREST_RECEIVE', 'Interest received from ' || v_instrument.title
            FROM public.wallets
            WHERE user_id = v_holder.user_id;
            
            v_count_holders := v_count_holders + 1;
        END LOOP;

        UPDATE public.instrument_deliverables
        SET status = 'ISSUED',
            updated_at = NOW()
        WHERE id = p_deliverable_id;
        
        RETURN jsonb_build_object('success', true, 'message', 'Interest Paid Successfully to ' || v_count_holders || ' holders. Total: ' || v_total_payout_needed);
    END IF;

    RETURN jsonb_build_object('success', false, 'message', 'Unexpected Error');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
