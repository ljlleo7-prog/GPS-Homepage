-- Restructure Database & Fix Schema Links
-- 1. Restore missing columns in 'profiles' (caused by accidental recreation)
-- 2. Force all dependent tables to link to 'profiles' (not auth.users)
-- 3. Ensure data integrity

-- ==============================================================================
-- 1. RESTORE MISSING PROFILE COLUMNS
-- ==============================================================================
DO $$
BEGIN
    -- developer_status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'developer_status') THEN
        ALTER TABLE public.profiles ADD COLUMN developer_status TEXT DEFAULT 'NONE' CHECK (developer_status IN ('NONE', 'PENDING', 'APPROVED'));
    END IF;

    -- full_name
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'full_name') THEN
        ALTER TABLE public.profiles ADD COLUMN full_name TEXT;
    END IF;

    -- last_minigame_reward_at (Fixes the specific error reported)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'last_minigame_reward_at') THEN
        ALTER TABLE public.profiles ADD COLUMN last_minigame_reward_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- tester_programs
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'tester_programs') THEN
        ALTER TABLE public.profiles ADD COLUMN tester_programs TEXT[] DEFAULT '{}';
    END IF;
END $$;

-- ==============================================================================
-- 2. ENFORCE FOREIGN KEYS TO PUBLIC.PROFILES
-- This ensures that "everything that needs a username display" can actually find it.
-- ==============================================================================

-- A. Minigame Scores (Critical for Leaderboard)
DO $$
BEGIN
    -- Drop old FK (referencing auth.users)
    BEGIN ALTER TABLE public.minigame_scores DROP CONSTRAINT IF EXISTS minigame_scores_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    -- Add new FK (referencing profiles)
    ALTER TABLE public.minigame_scores 
    ADD CONSTRAINT minigame_scores_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- B. Forum Posts
DO $$
BEGIN
    BEGIN ALTER TABLE public.forum_posts DROP CONSTRAINT IF EXISTS forum_posts_author_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.forum_posts 
    ADD CONSTRAINT forum_posts_author_id_fkey 
    FOREIGN KEY (author_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- C. Mission Submissions
DO $$
BEGIN
    BEGIN ALTER TABLE public.mission_submissions DROP CONSTRAINT IF EXISTS mission_submissions_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.mission_submissions 
    ADD CONSTRAINT mission_submissions_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- D. Wallets (Already working, but reinforcing)
DO $$
BEGIN
    BEGIN ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.wallets 
    ADD CONSTRAINT wallets_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- E. User Ticket Balances
DO $$
BEGIN
    BEGIN ALTER TABLE public.user_ticket_balances DROP CONSTRAINT IF EXISTS user_ticket_balances_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.user_ticket_balances 
    ADD CONSTRAINT user_ticket_balances_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- F. One Lap Leaderboard
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_leaderboard DROP CONSTRAINT IF EXISTS one_lap_leaderboard_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_leaderboard 
    ADD CONSTRAINT one_lap_leaderboard_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- ==============================================================================
-- 3. VERIFY & FIX ORPHANS (Again, to be safe)
-- ==============================================================================
-- Now that columns and keys are fixed, we run a quick adoption pass for the current user
-- to grab any data that might still be hanging on the old ID but not linked.

CREATE OR REPLACE FUNCTION public.quick_adopt_orphans()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;

  -- Adopt Scores
  UPDATE public.minigame_scores SET user_id = v_user_id WHERE user_id NOT IN (SELECT id FROM public.profiles);
  
  -- Adopt Posts
  UPDATE public.forum_posts SET author_id = v_user_id WHERE author_id NOT IN (SELECT id FROM public.profiles);
  
  -- Adopt Missions
  UPDATE public.mission_submissions SET user_id = v_user_id WHERE user_id NOT IN (SELECT id FROM public.profiles);
END;
$$;

-- Note: User must run 'SELECT public.quick_adopt_orphans();' or rely on previous reclaim script.
