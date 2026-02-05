-- ==========================================
-- FORUM SYSTEM & REPUTATION GATING
-- 1. Forum Posts Table
-- 2. RLS Policies (Read: Public, Create: Rep >= 50)
-- 3. Admin Reward Function
-- ==========================================

-- 1. FORUM POSTS
CREATE TABLE IF NOT EXISTS public.forum_posts (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  is_featured BOOLEAN DEFAULT false,
  reward_amount NUMERIC(20, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. RLS POLICIES
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;

-- Read: Public
CREATE POLICY "Forum posts are viewable by everyone" 
ON public.forum_posts FOR SELECT USING (true);

-- Create: Rep >= 50
-- Note: We use the helper function public.get_my_reputation() defined in 20240206_reputation_system.sql
CREATE POLICY "Users with Rep >= 50 can create posts" 
ON public.forum_posts 
FOR INSERT 
WITH CHECK (
  auth.uid() = author_id AND
  public.get_my_reputation() >= 50
);

-- Update: Author only (for content)
CREATE POLICY "Authors can update their own posts" 
ON public.forum_posts 
FOR UPDATE 
USING (auth.uid() = author_id)
WITH CHECK (auth.uid() = author_id);

-- Delete: Author only
CREATE POLICY "Authors can delete their own posts" 
ON public.forum_posts 
FOR DELETE 
USING (auth.uid() = author_id);


-- 3. REWARD FUNCTION (Admin/Official Only)
-- This function allows an admin (or system) to select a post and give a variable bonus.
CREATE OR REPLACE FUNCTION public.reward_forum_post(
  p_post_id UUID,
  p_amount NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_author_id UUID;
  v_current_reward NUMERIC;
  v_wallet_id UUID;
  v_caller_id UUID := auth.uid();
  v_is_dev BOOLEAN;
BEGIN
  -- 1. Check if caller is a developer/admin
  -- We assume 'developer_status' = 'APPROVED' in profiles means they have rights.
  SELECT (developer_status = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_is_dev IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized: Only approved developers can reward posts.';
  END IF;

  -- 2. Get Post Details
  SELECT author_id, reward_amount INTO v_author_id, v_current_reward
  FROM public.forum_posts
  WHERE id = p_post_id;

  IF v_author_id IS NULL THEN
    RAISE EXCEPTION 'Post not found.';
  END IF;

  -- 3. Prevent double rewarding (optional, but good for safety)
  -- Or we can allow adding more? Let's assume it's a one-time selection for now, or additive.
  -- Let's make it additive for flexibility, or just set it.
  -- Requirement: "selected ones ... can receive variable token bonus".
  
  -- 4. Update Post
  UPDATE public.forum_posts
  SET 
    is_featured = true,
    reward_amount = COALESCE(reward_amount, 0) + p_amount
  WHERE id = p_post_id;

  -- 5. Transfer Tokens (Mint/Reward)
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_author_id;

  UPDATE public.wallets
  SET token_balance = token_balance + p_amount
  WHERE id = v_wallet_id;

  -- 6. Log to Ledger
  INSERT INTO public.ledger_entries (
    wallet_id,
    amount,
    currency,
    operation_type,
    reference_id,
    description
  ) VALUES (
    v_wallet_id,
    p_amount,
    'TOKEN',
    'REWARD',
    p_post_id,
    'Forum Post Reward by Dev ' || v_caller_id
  );

  RETURN jsonb_build_object('success', true, 'new_total_reward', v_current_reward + p_amount);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
