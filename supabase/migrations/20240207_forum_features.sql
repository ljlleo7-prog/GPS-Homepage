
-- Forum Enhancements: Comments, Likes, and Variable Rewards

-- 1. Forum Comments
CREATE TABLE IF NOT EXISTS public.forum_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for Comments
ALTER TABLE public.forum_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Comments are viewable by everyone" ON public.forum_comments
  FOR SELECT USING (true);

CREATE POLICY "Users can create comments" ON public.forum_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 2. Forum Likes
CREATE TABLE IF NOT EXISTS public.forum_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- RLS for Likes
ALTER TABLE public.forum_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Likes are viewable by everyone" ON public.forum_likes
  FOR SELECT USING (true);

CREATE POLICY "Users can create likes" ON public.forum_likes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove their likes" ON public.forum_likes
  FOR DELETE USING (auth.uid() = user_id);

-- 3. Variable Reward (Acknowledge)
-- Replaces/Upgrades the fixed reward logic
CREATE OR REPLACE FUNCTION public.acknowledge_forum_post(
  p_post_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB AS $$
DECLARE
  v_post_author_id UUID;
  v_current_user_id UUID := auth.uid();
  v_is_admin BOOLEAN;
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

  -- Update post reward amount
  UPDATE public.forum_posts
  SET reward_amount = COALESCE(reward_amount, 0) + p_amount
  WHERE id = p_post_id;

  -- Transfer tokens (Minting new tokens for reward)
  UPDATE public.wallets
  SET token_balance = token_balance + p_amount
  WHERE user_id = v_post_author_id;

  -- Log to ledger
  INSERT INTO public.ledger_entries (
    wallet_id,
    amount,
    currency,
    operation_type,
    description
  ) 
  SELECT 
    id,
    p_amount,
    'TOKEN',
    'REWARD',
    'Forum Post Acknowledgement from Developer'
  FROM public.wallets
  WHERE user_id = v_post_author_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
