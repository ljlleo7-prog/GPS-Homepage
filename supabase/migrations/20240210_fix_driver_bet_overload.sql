-- Fix ambiguous function overload by dropping old signatures and recreating a single unified function
-- Drop all previous variations to ensure a clean slate
DROP FUNCTION IF EXISTS public.create_driver_bet(text, text, text, text, numeric, integer, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.create_driver_bet(text, text, text, numeric, integer, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.create_driver_bet(text, text, text, numeric, integer, timestamptz, timestamptz, text);

-- Create Unified Function
CREATE OR REPLACE FUNCTION public.create_driver_bet(
  p_title TEXT,
  p_description TEXT,
  p_side_a_name TEXT,
  p_ticket_price NUMERIC,
  p_ticket_limit INTEGER,
  p_official_end_date TIMESTAMPTZ,
  p_open_date TIMESTAMPTZ,
  p_side_b_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_instrument_id UUID;
  v_ticket_a_id UUID;
  v_ticket_b_id UUID;
  v_side_a_full TEXT;
  v_side_b_full TEXT;
  v_rep_balance NUMERIC;
BEGIN
  -- Reputation Check
  SELECT reputation_balance INTO v_rep_balance FROM public.wallets WHERE user_id = v_user_id;
  IF v_rep_balance IS NULL OR v_rep_balance <= 50 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Reputation too low (< 50)');
  END IF;

  -- Validate Price
  IF p_ticket_price < 0.1 OR p_ticket_price > 100 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ticket price must be between 0.1 and 100');
  END IF;

  -- Determine Side Names
  IF p_side_b_name IS NOT NULL AND p_side_b_name != '' THEN
    v_side_a_full := p_side_a_name;
    v_side_b_full := p_side_b_name;
  ELSE
    -- Auto-generate (Legacy behavior)
    v_side_a_full := p_side_a_name || ' will happen';
    v_side_b_full := p_side_a_name || ' will not happen';
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
  -- Side A
  INSERT INTO public.ticket_types (creator_id, title, description, total_supply)
  VALUES (
    v_user_id, 
    p_title || ' (' || v_side_a_full || ')', 
    'Bet: ' || v_side_a_full, 
    p_ticket_limit
  )
  RETURNING id INTO v_ticket_a_id;

  -- Side B
  INSERT INTO public.ticket_types (creator_id, title, description, total_supply)
  VALUES (
    v_user_id, 
    p_title || ' (' || v_side_b_full || ')', 
    'Bet: ' || v_side_b_full, 
    p_ticket_limit
  )
  RETURNING id INTO v_ticket_b_id;

  -- Update Instrument with Ticket IDs
  UPDATE public.support_instruments
  SET ticket_type_a_id = v_ticket_a_id,
      ticket_type_b_id = v_ticket_b_id
  WHERE id = v_instrument_id;

  RETURN jsonb_build_object('success', true, 'id', v_instrument_id);
END;
$$;
