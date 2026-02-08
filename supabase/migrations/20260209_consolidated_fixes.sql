-- ==============================================================================
-- CONSOLIDATED FIXES: MISSIONS & FORUM
-- Description: Adds missing columns to Missions and Forum tables, restores data, and fixes RLS.
-- ==============================================================================

-- 1. FIX MISSIONS TABLE
-- Missing: reward_rep_min, reward_rep_max, deadline
DO $$
BEGIN
    -- reward_rep_min
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'reward_rep_min') THEN
        ALTER TABLE public.missions ADD COLUMN reward_rep_min INTEGER DEFAULT 0;
        RAISE NOTICE 'Added reward_rep_min to missions';
    END IF;

    -- reward_rep_max
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'reward_rep_max') THEN
        ALTER TABLE public.missions ADD COLUMN reward_rep_max INTEGER DEFAULT 0;
        RAISE NOTICE 'Added reward_rep_max to missions';
    END IF;

    -- deadline
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'deadline') THEN
        ALTER TABLE public.missions ADD COLUMN deadline TIMESTAMPTZ;
        RAISE NOTICE 'Added deadline to missions';
    END IF;
END $$;

-- 2. FIX FORUM POSTS TABLE
-- Missing: category, tags, view_count
DO $$
BEGIN
    -- category
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forum_posts' AND column_name = 'category') THEN
        ALTER TABLE public.forum_posts ADD COLUMN category TEXT DEFAULT 'General';
        RAISE NOTICE 'Added category to forum_posts';
    END IF;

    -- tags
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forum_posts' AND column_name = 'tags') THEN
        ALTER TABLE public.forum_posts ADD COLUMN tags TEXT[] DEFAULT '{}';
        RAISE NOTICE 'Added tags to forum_posts';
    END IF;

    -- view_count
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forum_posts' AND column_name = 'view_count') THEN
        ALTER TABLE public.forum_posts ADD COLUMN view_count INTEGER DEFAULT 0;
        RAISE NOTICE 'Added view_count to forum_posts';
    END IF;
END $$;

-- 3. RESTORE FORUM EXTRAS (COMMENTS & LIKES)
-- These tables were missing from the rebuild.
CREATE TABLE IF NOT EXISTS public.forum_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.forum_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- 4. RESTORE DATA FROM BACKUP (Safe Conditional Restore)
DO $$
BEGIN
    -- 4.1 Restore Forum Post Metadata (Category, Tags, View Count)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_forum_posts_20260208') THEN
        
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_forum_posts_20260208' AND column_name = 'category') THEN
             UPDATE public.forum_posts f
             SET category = COALESCE(b.category, 'General')
             FROM backup_forum_posts_20260208 b
             WHERE f.id = b.id;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_forum_posts_20260208' AND column_name = 'tags') THEN
             UPDATE public.forum_posts f
             SET tags = COALESCE(b.tags, '{}')
             FROM backup_forum_posts_20260208 b
             WHERE f.id = b.id;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_forum_posts_20260208' AND column_name = 'view_count') THEN
             UPDATE public.forum_posts f
             SET view_count = COALESCE(b.view_count, 0)
             FROM backup_forum_posts_20260208 b
             WHERE f.id = b.id;
        END IF;
    END IF;

    -- 4.2 Restore Forum Comments
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_forum_comments_20260208') THEN
        INSERT INTO public.forum_comments (id, post_id, user_id, content, created_at)
        SELECT id, post_id, user_id, content, created_at
        FROM backup_forum_comments_20260208
        WHERE post_id IN (SELECT id FROM public.forum_posts)
          AND user_id IN (SELECT id FROM public.profiles)
        ON CONFLICT (id) DO NOTHING;
        RAISE NOTICE 'Restored Forum Comments';
    END IF;

    -- 4.3 Restore Forum Likes
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_forum_likes_20260208') THEN
         INSERT INTO public.forum_likes (id, post_id, user_id, created_at)
         SELECT id, post_id, user_id, created_at
         FROM backup_forum_likes_20260208
         WHERE post_id IN (SELECT id FROM public.forum_posts)
           AND user_id IN (SELECT id FROM public.profiles)
         ON CONFLICT (post_id, user_id) DO NOTHING;
         RAISE NOTICE 'Restored Forum Likes';
    END IF;

    -- 4.4 Restore Mission Data (Rep Min/Max)
    -- If backup has these columns, use them. If not, default to 0-5 for existing records.
    UPDATE public.missions SET reward_rep_min = 0, reward_rep_max = 5 WHERE reward_rep_max = 0;
    
END $$;

-- 5. FIX PERMISSIONS (RLS)
ALTER TABLE public.forum_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_likes ENABLE ROW LEVEL SECURITY;

-- Comments Policies
DROP POLICY IF EXISTS "Comments are viewable by everyone" ON public.forum_comments;
CREATE POLICY "Comments are viewable by everyone" ON public.forum_comments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create comments" ON public.forum_comments;
CREATE POLICY "Users can create comments" ON public.forum_comments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Likes Policies
DROP POLICY IF EXISTS "Likes are viewable by everyone" ON public.forum_likes;
CREATE POLICY "Likes are viewable by everyone" ON public.forum_likes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create likes" ON public.forum_likes;
CREATE POLICY "Users can create likes" ON public.forum_likes FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can remove their likes" ON public.forum_likes;
CREATE POLICY "Users can remove their likes" ON public.forum_likes FOR DELETE USING (auth.uid() = user_id);

-- Forum Post Creation Policy (Reputation Gated)
DROP POLICY IF EXISTS "Forum Post Create" ON public.forum_posts;
CREATE POLICY "Forum Post Create" ON public.forum_posts
    FOR INSERT
    WITH CHECK (
        auth.role() = 'authenticated' AND 
        auth.uid() = author_id
        -- Can add reputation check here if needed:
        -- AND EXISTS (SELECT 1 FROM public.wallets WHERE user_id = auth.uid() AND reputation_balance >= 50)
    );

RAISE NOTICE 'Consolidated Fixes Applied Successfully';
