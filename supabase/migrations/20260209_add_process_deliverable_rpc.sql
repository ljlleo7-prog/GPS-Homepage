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
    v_total_tickets NUMERIC;
    v_payout_amount NUMERIC;
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
    IF p_action = 'ISSUE' THEN
        -- Get Instrument Info for Payout Calculation (if we were automating payouts)
        -- For now, we just mark as ISSUED. 
        -- NOTE: In a real scenario, this might trigger a payout from a reserve to ticket holders.
        -- Or simply mark it as "Met", avoiding penalty.
        
        UPDATE public.instrument_deliverables
        SET status = 'ISSUED',
            updated_at = NOW()
        WHERE id = p_deliverable_id;
        
        RETURN jsonb_build_object('success', true, 'message', 'Deliverable Issued Successfully');

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
