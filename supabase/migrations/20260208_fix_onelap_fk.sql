-- Restore Foreign Keys for One Lap Duel & Other Tables
-- These were lost when 'profiles' was dropped with CASCADE.

-- ==========================================
-- 1. ONE LAP DUEL TABLES
-- ==========================================

-- A. One Lap Drivers
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_drivers DROP CONSTRAINT IF EXISTS one_lap_drivers_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_drivers 
    ADD CONSTRAINT one_lap_drivers_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- B. One Lap Rooms (created_by)
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_rooms DROP CONSTRAINT IF EXISTS one_lap_rooms_created_by_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_rooms 
    ADD CONSTRAINT one_lap_rooms_created_by_fkey 
    FOREIGN KEY (created_by) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- C. One Lap Room Players (user_id)
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_room_players DROP CONSTRAINT IF EXISTS one_lap_room_players_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_room_players 
    ADD CONSTRAINT one_lap_room_players_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- D. One Lap Races (winner_id)
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_races DROP CONSTRAINT IF EXISTS one_lap_races_winner_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_races 
    ADD CONSTRAINT one_lap_races_winner_id_fkey 
    FOREIGN KEY (winner_id) 
    REFERENCES public.profiles(id) 
    ON DELETE SET NULL;
END $$;

-- E. One Lap Leaderboard (user_id)
DO $$
BEGIN
    BEGIN ALTER TABLE public.one_lap_leaderboard DROP CONSTRAINT IF EXISTS one_lap_leaderboard_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.one_lap_leaderboard 
    ADD CONSTRAINT one_lap_leaderboard_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- ==========================================
-- 2. ECONOMY & MISSIONS (Missing from previous fixes)
-- ==========================================

-- F. Support Positions
DO $$
BEGIN
    BEGIN ALTER TABLE public.support_positions DROP CONSTRAINT IF EXISTS support_positions_user_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.support_positions 
    ADD CONSTRAINT support_positions_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES public.profiles(id) 
    ON DELETE CASCADE;
END $$;

-- G. Missions (Creator)
DO $$
BEGIN
    BEGIN ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS missions_creator_id_fkey; EXCEPTION WHEN OTHERS THEN NULL; END;
    
    ALTER TABLE public.missions 
    ADD CONSTRAINT missions_creator_id_fkey 
    FOREIGN KEY (creator_id) 
    REFERENCES public.profiles(id) 
    ON DELETE SET NULL;
END $$;
