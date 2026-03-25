-- 1. Clear "Featured" status from all posts
UPDATE public.forum_posts SET is_featured = false;

-- 2. Update acknowledge_forum_post to award both Tokens and Reputation
CREATE OR REPLACE FUNCTION public.acknowledge_forum_post(
  p_post_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_author_id UUID;
  v_current_user_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_wallet_id UUID;
BEGIN
  -- Check if user is admin/developer
  SELECT (developer_status = 'APPROVED') INTO v_is_admin
  FROM public.profiles
  WHERE id = v_current_user_id;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: Developer access required');
  END IF;

  -- Validate amount (1 to 1000)
  IF p_amount < 1 OR p_amount > 1000 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Amount must be between 1 and 1000');
  END IF;

  -- Get post author
  SELECT author_id INTO v_post_author_id
  FROM public.forum_posts
  WHERE id = p_post_id;

  IF v_post_author_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Post not found');
  END IF;

  -- Get wallet id
  SELECT id INTO v_wallet_id
  FROM public.wallets
  WHERE user_id = v_post_author_id;

  IF v_wallet_id IS NULL THEN
      -- Create wallet if missing (safety fallback)
      INSERT INTO public.wallets (user_id, token_balance, reputation_balance)
      VALUES (v_post_author_id, 0, 0)
      RETURNING id INTO v_wallet_id;
  END IF;

  -- Update post reward amount (track tokens given)
  UPDATE public.forum_posts
  SET reward_amount = COALESCE(reward_amount, 0) + p_amount,
      is_featured = false -- Ensure it doesn't get featured by default or reset it
  WHERE id = p_post_id;

  -- Transfer tokens (Minting new tokens for reward)
  UPDATE public.wallets
  SET token_balance = token_balance + p_amount,
      reputation_balance = reputation_balance + CAST(p_amount AS INTEGER)
  WHERE id = v_wallet_id;

  -- Log to ledger (Tokens)
  INSERT INTO public.ledger_entries (
    wallet_id,
    amount,
    currency,
    operation_type,
    description
  ) VALUES (
    v_wallet_id,
    p_amount,
    'TOKEN',
    'REWARD',
    'Forum Post Acknowledgement: ' || p_post_id
  );

  -- Log to ledger (Reputation)
  INSERT INTO public.ledger_entries (
    wallet_id,
    amount,
    currency,
    operation_type,
    description
  ) VALUES (
    v_wallet_id,
    p_amount, -- Same amount for reputation
    'REP',
    'REWARD',
    'Forum Post Acknowledgement: ' || p_post_id
  );

  RETURN jsonb_build_object('success', true, 'message', 'Post acknowledged and rewarded (Tokens & Reputation)');
END;
$$;
