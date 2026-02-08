-- ==============================================================================
-- RESTORE FORUM EXTRAS (COMMENTS, LIKES, FUNCTIONS)
-- Description: Re-creates missing forum tables and restores data/functions
-- ==============================================================================

-- 1. Forum Comments
CREATE TABLE IF NOT EXISTS public.forum_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Forum Likes
CREATE TABLE IF NOT EXISTS public.forum_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- 3. RLS Policies
ALTER TABLE public.forum_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_likes ENABLE ROW LEVEL SECURITY;

-- Policies for Comments
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.forum_comments;
CREATE POLICY "Comments are viewable by everyone" ON public.forum_comments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create comments" ON public.forum_comments;
CREATE POLICY "Users can create comments" ON public.forum_comments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policies for Likes
DROP POLICY IF EXISTS "Likes are viewable by everyone" ON public.forum_likes;
CREATE POLICY "Likes are viewable by everyone" ON public.forum_likes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create likes" ON public.forum_likes;
CREATE POLICY "Users can create likes" ON public.forum_likes FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can remove their likes" ON public.forum_likes;
CREATE POLICY "Users can remove their likes" ON public.forum_likes FOR DELETE USING (auth.uid() = user_id);

-- 4. Restore Data
DO $$
BEGIN
    -- Restore Comments
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_forum_comments_20260208') THEN
        INSERT INTO public.forum_comments (id, post_id, user_id, content, created_at)
        SELECT id, post_id, user_id, content, created_at
        FROM backup_forum_comments_20260208
        WHERE post_id IN (SELECT id FROM public.forum_posts)
          AND user_id IN (SELECT id FROM public.profiles)
        ON CONFLICT (id) DO NOTHING;
        RAISE NOTICE 'Restored Forum Comments';
    END IF;

    -- Restore Likes (Try backup table if exists, otherwise empty)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_forum_likes_20260208') THEN
         INSERT INTO public.forum_likes (id, post_id, user_id, created_at)
         SELECT id, post_id, user_id, created_at
         FROM backup_forum_likes_20260208
         WHERE post_id IN (SELECT id FROM public.forum_posts)
           AND user_id IN (SELECT id FROM public.profiles)
         ON CONFLICT (post_id, user_id) DO NOTHING;
         RAISE NOTICE 'Restored Forum Likes';
    END IF;
END $$;

-- 5. Restore Function: acknowledge_forum_post
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
    'Forum Post Acknowledgement: ' || p_post_id
  FROM public.wallets
  WHERE user_id = v_post_author_id;

  RETURN jsonb_build_object('success', true, 'message', 'Post acknowledged and rewarded');
END;
$$;
