-- ==============================================================================
-- FORCE FIX RELATIONSHIPS
-- Description: Explicitly recreates Foreign Keys for Forum Tables to fix PostgREST detection
-- ==============================================================================

DO $$
BEGIN
    -- 1. Forum Likes -> Forum Posts
    -- Check if table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forum_likes') THEN
        RAISE NOTICE 'Creating forum_likes table...';
        CREATE TABLE public.forum_likes (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          post_id UUID NOT NULL,
          user_id UUID NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(post_id, user_id)
        );
        ALTER TABLE public.forum_likes ENABLE ROW LEVEL SECURITY;
    END IF;

    -- Drop potential existing constraint (by name or just force add)
    -- We try to drop common names
    BEGIN
        ALTER TABLE public.forum_likes DROP CONSTRAINT IF EXISTS forum_likes_post_id_fkey;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Add the Constraint Explicitly
    ALTER TABLE public.forum_likes
    ADD CONSTRAINT forum_likes_post_id_fkey
    FOREIGN KEY (post_id) REFERENCES public.forum_posts(id) ON DELETE CASCADE;

    -- 2. Forum Likes -> Profiles (User)
    BEGIN
        ALTER TABLE public.forum_likes DROP CONSTRAINT IF EXISTS forum_likes_user_id_fkey;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ALTER TABLE public.forum_likes
    ADD CONSTRAINT forum_likes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


    -- 3. Forum Comments -> Forum Posts
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forum_comments') THEN
        RAISE NOTICE 'Creating forum_comments table...';
        CREATE TABLE public.forum_comments (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          post_id UUID NOT NULL,
          user_id UUID NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE public.forum_comments ENABLE ROW LEVEL SECURITY;
    END IF;

    BEGIN
        ALTER TABLE public.forum_comments DROP CONSTRAINT IF EXISTS forum_comments_post_id_fkey;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ALTER TABLE public.forum_comments
    ADD CONSTRAINT forum_comments_post_id_fkey
    FOREIGN KEY (post_id) REFERENCES public.forum_posts(id) ON DELETE CASCADE;

    -- 4. Forum Comments -> Profiles
    BEGIN
        ALTER TABLE public.forum_comments DROP CONSTRAINT IF EXISTS forum_comments_user_id_fkey;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ALTER TABLE public.forum_comments
    ADD CONSTRAINT forum_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

    RAISE NOTICE 'Relationships Force-Fixed';
END $$;

-- Reload Schema Cache (Supabase specific)
NOTIFY pgrst, 'reload config';
