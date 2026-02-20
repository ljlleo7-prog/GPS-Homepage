CREATE OR REPLACE FUNCTION public.withdraw_ticket_listing(
  p_listing_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_seller_id UUID;
  v_ticket_type_id UUID;
  v_quantity INTEGER;
  v_status TEXT;
BEGIN
  SELECT seller_id, ticket_type_id, quantity, status
  INTO v_seller_id, v_ticket_type_id, v_quantity, v_status
  FROM public.ticket_listings
  WHERE id = p_listing_id;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Listing not found');
  END IF;

  IF v_seller_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not your listing');
  END IF;

  IF v_status != 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Listing not active');
  END IF;

  UPDATE public.ticket_listings
  SET status = 'CANCELLED'
  WHERE id = p_listing_id;

  INSERT INTO public.user_ticket_balances (user_id, ticket_type_id, balance)
  VALUES (v_seller_id, v_ticket_type_id, v_quantity)
  ON CONFLICT (user_id, ticket_type_id)
  DO UPDATE SET balance = user_ticket_balances.balance + EXCLUDED.balance;

  RETURN jsonb_build_object('success', true);
END;
$$;
