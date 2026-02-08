-- COMPREHENSIVE REPAIR OF FOREIGN KEY CONSTRAINTS
-- This migration systematically restores the link between all user-related tables and the 'profiles' table.
-- This is necessary because 'DROP TABLE profiles CASCADE' removed all these constraints.

-- Helper macro for safe recreation (conceptually)
-- We will use DO blocks for each table.

-- ==============================================================================
-- 1. CORE ECONOMY
-- ==============================================================================

-- Wallets
DO $$
BEGIN
    -- Drop old/broken constraints
    BEGIN ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    -- Re-add Constraint
    ALTER TABLE public.wallets 
    ADD CONSTRAINT wallets_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- User Ticket Balances
DO $$
BEGIN
    BEGIN ALTER TABLE public.user_ticket_balances DROP CONSTRAINT IF EXISTS user_ticket_balances_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.user_ticket_balances 
    ADD CONSTRAINT user_ticket_balances_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- Support Positions
DO $$
BEGIN
    BEGIN ALTER TABLE public.support_positions DROP CONSTRAINT IF EXISTS support_positions_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.support_positions 
    ADD CONSTRAINT support_positions_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- ==============================================================================
-- 2. MISSIONS & CAMPAIGNS
-- ==============================================================================

-- Missions (Creator)
DO $$
BEGIN
    BEGIN ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS missions_creator_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.missions 
    ADD CONSTRAINT missions_creator_id_fkey 
    FOREIGN KEY (creator_id) 
    REFERENCES public.profiles(id) 
    ON DELETE SET NULL;
END $$;

-- Mission Submissions
DO $$
BEGIN
    BEGIN ALTER TABLE public.mission_submissions DROP CONSTRAINT IF EXISTS mission_submissions_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.mission_submissions 
    ADD CONSTRAINT mission_submissions_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- ==============================================================================
-- 3. FORUM & SOCIAL
-- ==============================================================================

-- Forum Posts
DO $$
BEGIN
    BEGIN ALTER TABLE public.forum_posts DROP CONSTRAINT IF EXISTS forum_posts_author_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.forum_posts 
    ADD CONSTRAINT forum_posts_author_id_fkey 
    FOREIGN KEY (author_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- Forum Comments
DO $$
BEGIN
    BEGIN ALTER TABLE public.forum_comments DROP CONSTRAINT IF EXISTS forum_comments_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.forum_comments 
    ADD CONSTRAINT forum_comments_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- Forum Likes
DO $$
BEGIN
    BEGIN ALTER TABLE public.forum_likes DROP CONSTRAINT IF EXISTS forum_likes_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.forum_likes 
    ADD CONSTRAINT forum_likes_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- ==============================================================================
-- 4. MINIGAMES (REACTION)
-- ==============================================================================

-- Minigame Scores
DO $$
BEGIN
    BEGIN ALTER TABLE public.minigame_scores DROP CONSTRAINT IF EXISTS minigame_scores_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.minigame_scores 
    ADD CONSTRAINT minigame_scores_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- ==============================================================================
-- 5. MINIGAMES (ONE LAP DUEL)
-- ==============================================================================

-- One Lap Drivers
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_drivers DROP CONSTRAINT IF EXISTS one_lap_drivers_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_drivers 
    ADD CONSTRAINT one_lap_drivers_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- One Lap Rooms
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_rooms DROP CONSTRAINT IF EXISTS one_lap_rooms_created_by_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_rooms 
    ADD CONSTRAINT one_lap_rooms_created_by_fkey 
    FOREIGN KEY (created_by) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- One Lap Room Players
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_room_players DROP CONSTRAINT IF EXISTS one_lap_room_players_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_room_players 
    ADD CONSTRAINT one_lap_room_players_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- One Lap Races
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_races DROP CONSTRAINT IF EXISTS one_lap_races_winner_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_races 
    ADD CONSTRAINT one_lap_races_winner_id_fkey 
    FOREIGN KEY (winner_id) 
    REFERENCES public.profiles(id) 
    ON DELETE SET NULL;
END $$;

-- One Lap Leaderboard
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
-- 6. DEVELOPER & TESTER REQUESTS
-- ==============================================================================

-- Developer Requests (Check table existence first)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'developer_requests') THEN
        BEGIN ALTER TABLE public.developer_requests DROP CONSTRAINT IF EXISTS developer_requests_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
        
        ALTER TABLE public.developer_requests 
        ADD CONSTRAINT developer_requests_user_id_fkey 
        FOREIGN KEY (user_id) 
        REFERENCES public.profiles(id) 
        ON DELETE CASCADE;
    END IF;
END $$;

-- Test Player Requests (Check table existence first)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'test_player_requests') THEN
        BEGIN ALTER TABLE public.test_player_requests DROP CONSTRAINT IF EXISTS test_player_requests_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
        
        ALTER TABLE public.test_player_requests 
        ADD CONSTRAINT test_player_requests_user_id_fkey 
        FOREIGN KEY (user_id) 
        REFERENCES public.profiles(id) 
        ON DELETE CASCADE;
    END IF;
END $$;

