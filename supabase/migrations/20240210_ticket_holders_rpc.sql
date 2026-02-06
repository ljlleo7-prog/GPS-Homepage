-- Function to get ticket holders for a specific ticket type
-- Returns data only if the user is the CREATOR or an INVESTOR (balance > 0)
CREATE OR REPLACE FUNCTION get_ticket_holders(p_ticket_type_id UUID)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    balance INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_creator_id UUID;
    v_user_balance INTEGER;
BEGIN
    -- 1. Get Ticket Info
    SELECT creator_id INTO v_creator_id
    FROM public.ticket_types
    WHERE id = p_ticket_type_id;

    -- 2. Check User Balance
    SELECT balance INTO v_user_balance
    FROM public.user_ticket_balances
    WHERE ticket_type_id = p_ticket_type_id AND user_id = v_user_id;

    -- 3. Access Control: Must be Creator OR Investor (balance > 0)
    IF v_user_id = v_creator_id OR (v_user_balance IS NOT NULL AND v_user_balance > 0) THEN
        RETURN QUERY
        SELECT 
            utb.user_id,
            p.username,
            utb.balance
        FROM public.user_ticket_balances utb
        JOIN public.profiles p ON utb.user_id = p.id
        WHERE utb.ticket_type_id = p_ticket_type_id
        AND utb.balance > 0
        ORDER BY utb.balance DESC;
    ELSE
        -- Return empty set if not authorized
        RETURN;
    END IF;
END;
$$;
