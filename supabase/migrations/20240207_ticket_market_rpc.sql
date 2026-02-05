-- 1. Create Ticket Listing RPC
CREATE OR REPLACE FUNCTION public.create_ticket_listing(
  p_ticket_type_id UUID,
  p_quantity INTEGER,
  p_price NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep INTEGER;
  v_balance INTEGER;
  v_listing_id UUID;
BEGIN
  -- 1. Check Reputation
  SELECT reputation_balance INTO v_rep FROM public.wallets WHERE user_id = v_user_id;
  IF v_rep <= 50 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Reputation too low (< 50)');
  END IF;

  -- 2. Check Ticket Balance
  SELECT balance INTO v_balance FROM public.user_ticket_balances 
  WHERE user_id = v_user_id AND ticket_type_id = p_ticket_type_id;
  
  IF v_balance IS NULL OR v_balance < p_quantity THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient ticket balance');
  END IF;

  -- 3. Deduct Tickets (Escrow)
  UPDATE public.user_ticket_balances
  SET balance = balance - p_quantity
  WHERE user_id = v_user_id AND ticket_type_id = p_ticket_type_id;

  -- 4. Create Listing
  INSERT INTO public.ticket_listings (seller_id, ticket_type_id, quantity, price_per_unit, status)
  VALUES (v_user_id, p_ticket_type_id, p_quantity, p_price, 'ACTIVE')
  RETURNING id INTO v_listing_id;

  RETURN jsonb_build_object('success', true, 'listing_id', v_listing_id);
END;
$$;

-- 2. Purchase Ticket Listing RPC
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
