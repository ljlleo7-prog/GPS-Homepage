-- ==============================================================================
-- DELIVERABLE PROCESSING LOGIC
-- Description:
-- 1. Creates process_deliverable RPC function for Developer Inbox.
-- 2. Handles ISSUE (mark as ISSUED) and REJECT (mark as REJECTED) actions.
-- 3. Future logic can include automatic payouts or penalties here.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.process_deliverable(
    p_deliverable_id UUID,
    p_action TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_is_dev BOOLEAN;
    v_current_status TEXT;
    v_instrument_id UUID;
    v_cost_per_ticket NUMERIC;
    v_ticket_type_id UUID;
    v_total_tickets NUMERIC := 0;
    v_total_payout NUMERIC := 0;
    v_instrument_title TEXT;
    v_dev_count INTEGER := 0;
    v_cost_per_dev NUMERIC := 0;
    v_holder RECORD;
    v_dev RECORD;
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
    IF p_action NOT IN ('ISSUE', 'REJECT', 'PRE_ISSUE') THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid Action');
    END IF;

    -- 3. Get Deliverable Info
    SELECT status, instrument_id INTO v_current_status, v_instrument_id
    FROM public.instrument_deliverables
    WHERE id = p_deliverable_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Deliverable not found');
    END IF;

    IF v_current_status != 'PENDING' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Deliverable is not pending');
    END IF;

    -- 4. Process Action
    IF p_action = 'PRE_ISSUE' THEN
        UPDATE public.instrument_deliverables
        SET status = 'PRE_ISSUED',
            updated_at = NOW()
        WHERE id = p_deliverable_id;
        RETURN jsonb_build_object('success', true, 'message', 'Deliverable Pre-Issued');

    ELSIF p_action = 'ISSUE' THEN
        -- Fetch instrument info (cost per ticket and linked ticket type)
        SELECT 
            deliverable_cost_per_ticket,
            ticket_type_id,
            title
        INTO 
            v_cost_per_ticket,
            v_ticket_type_id,
            v_instrument_title
        FROM public.support_instruments
        WHERE id = v_instrument_id;
        
        IF v_cost_per_ticket IS NULL THEN
            v_cost_per_ticket := 0;
        END IF;
        
        -- Compute total tickets for this instrument's ticket type (holders only)
        IF v_ticket_type_id IS NOT NULL THEN
            SELECT COALESCE(SUM(balance), 0) 
            INTO v_total_tickets
            FROM public.user_ticket_balances
            WHERE ticket_type_id = v_ticket_type_id
              AND balance > 0;
        END IF;
        
        v_total_payout := COALESCE(v_total_tickets, 0) * COALESCE(v_cost_per_ticket, 0);
        
        -- Mark as ISSUED
        UPDATE public.instrument_deliverables
        SET status = 'ISSUED',
            updated_at = NOW()
        WHERE id = p_deliverable_id;
        
        -- Distribute payouts to ticket holders
        IF v_ticket_type_id IS NOT NULL AND v_total_payout > 0 THEN
            FOR v_holder IN 
                SELECT user_id, balance 
                FROM public.user_ticket_balances 
                WHERE ticket_type_id = v_ticket_type_id 
                  AND balance > 0
            LOOP
                -- Individual holder payout = balance * cost_per_ticket
                UPDATE public.wallets
                SET token_balance = token_balance + (COALESCE(v_cost_per_ticket, 0) * v_holder.balance)
                WHERE user_id = v_holder.user_id;
                
                -- Ledger entry for holder (REWARD)
                INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
                SELECT 
                    id,
                    COALESCE(v_cost_per_ticket, 0) * v_holder.balance,
                    'TOKEN',
                    'REWARD',
                    'Deliverable Payout: ' || COALESCE(v_instrument_title, 'Unknown Instrument')
                FROM public.wallets
                WHERE user_id = v_holder.user_id;
            END LOOP;
        END IF;
        
        -- Charge developers equally to fund the payout
        SELECT COUNT(*) INTO v_dev_count 
        FROM public.profiles 
        WHERE developer_status = 'APPROVED';
        
        IF v_dev_count > 0 AND v_total_payout > 0 THEN
            v_cost_per_dev := v_total_payout / v_dev_count;
            
            FOR v_dev IN 
                SELECT id AS user_id 
                FROM public.profiles 
                WHERE developer_status = 'APPROVED'
            LOOP
                -- Deduct from each developer wallet
                UPDATE public.wallets 
                SET token_balance = token_balance - v_cost_per_dev
                WHERE user_id = v_dev.user_id;
                
                -- Ledger entry for developer deduction (SYSTEM)
                INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
                SELECT 
                    id,
                    -v_cost_per_dev,
                    'TOKEN',
                    'SYSTEM',
                    'Deliverable Funding: ' || COALESCE(v_instrument_title, 'Unknown Instrument')
                FROM public.wallets
                WHERE user_id = v_dev.user_id;
            END LOOP;
        END IF;
        
        RETURN jsonb_build_object(
            'success', true, 
            'message', 'Deliverable Issued Successfully',
            'payout_total', COALESCE(v_total_payout, 0),
            'ticket_type_id', v_ticket_type_id
        );

    ELSIF p_action = 'REJECT' THEN
        -- Mark as REJECTED. This effectively means the team failed to deliver.
        -- This might trigger a penalty in the future (e.g. paying out the cost to holders).
        
        UPDATE public.instrument_deliverables
        SET status = 'REJECTED',
            updated_at = NOW()
        WHERE id = p_deliverable_id;

        RETURN jsonb_build_object('success', true, 'message', 'Deliverable Rejected');
    END IF;

    RETURN jsonb_build_object('success', false, 'message', 'Unexpected Error');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
