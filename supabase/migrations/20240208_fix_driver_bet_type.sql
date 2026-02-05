-- Fix constraint and update Driver Bet logic
-- 1. Update support_instruments constraint to allow 'MARKET'
ALTER TABLE public.support_instruments DROP CONSTRAINT IF EXISTS support_instruments_type_check;
ALTER TABLE public.support_instruments ADD CONSTRAINT support_instruments_type_check 
  CHECK (type IN ('BOND', 'INDEX', 'MILESTONE', 'MARKET'));

-- 2. Update create_driver_bet RPC to auto-generate Side B
CREATE OR REPLACE FUNCTION public.create_driver_bet(
  p_title TEXT,
  p_description TEXT,
  p_side_a_name TEXT, -- The "Event" description
  p_ticket_price NUMERIC,
  p_ticket_limit INTEGER,
  p_official_end_date TIMESTAMPTZ,
  p_open_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep INTEGER;
  v_instrument_id UUID;
  v_ticket_a_id UUID;
  v_ticket_b_id UUID;
  v_side_a_full TEXT;
  v_side_b_full TEXT;
BEGIN
  -- Check Reputation
  SELECT reputation_balance INTO v_rep FROM public.wallets WHERE user_id = v_user_id;
  
  -- Logic: 50-69 can create (verified by dev), 70+ can create/resolve
  IF v_rep IS NULL OR v_rep < 50 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient Reputation (< 50)');
  END IF;

  -- Validate Dates
  IF p_official_end_date <= NOW() OR p_open_date <= p_official_end_date THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid dates: End date must be future, Open date must be after End date');
  END IF;

  -- Validate Price
  IF p_ticket_price < 0.1 OR p_ticket_price > 100 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ticket price must be between 0.1 and 100');
  END IF;

  -- Auto-generate Side Names
  v_side_a_full := p_side_a_name || ' will happen';
  v_side_b_full := p_side_a_name || ' will not happen';

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
    'MARKET',
    'OPEN',
    'HIGH',
    true,
    v_side_a_full,
    v_side_b_full,
    p_ticket_price,
    p_ticket_limit,
    p_official_end_date,
    p_open_date,
    'OPEN'
  ) RETURNING id INTO v_instrument_id;

  -- Create Ticket Types
  -- Side A (Yes)
  INSERT INTO public.ticket_types (creator_id, title, description, total_supply)
  VALUES (
    v_user_id, 
    p_title || ' (YES)', 
    'Bet: ' || v_side_a_full, 
    p_ticket_limit
  )
  RETURNING id INTO v_ticket_a_id;

  -- Side B (No)
  INSERT INTO public.ticket_types (creator_id, title, description, total_supply)
  VALUES (
    v_user_id, 
    p_title || ' (NO)', 
    'Bet: ' || v_side_b_full, 
    p_ticket_limit
  )
  RETURNING id INTO v_ticket_b_id;

  -- Update Instrument with Ticket IDs
  UPDATE public.support_instruments
  SET ticket_type_a_id = v_ticket_a_id,
      ticket_type_b_id = v_ticket_b_id
  WHERE id = v_instrument_id;

  RETURN jsonb_build_object('success', true, 'message', 'Driver Bet created successfully', 'id', v_instrument_id);
END;
$$;
