-- Fix RLS policies and ensure PK constraints for One Lap Duel
-- This migration ensures that the game tables are accessible to all authenticated users
-- and fixes potential 406 errors caused by duplicates or strict policies.

-- 1. Ensure PK on room_players
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'one_lap_room_players_pkey'
    ) THEN
        -- If no PK, we might have duplicates. Deduplicate first.
        DELETE FROM public.one_lap_room_players a USING public.one_lap_room_players b
        WHERE a.ctid < b.ctid 
        AND a.room_id = b.room_id 
        AND a.user_id = b.user_id;

        -- Add PK
        ALTER TABLE public.one_lap_room_players ADD PRIMARY KEY (room_id, user_id);
    END IF;
END $$;

-- 2. Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Drivers viewable by everyone" ON public.one_lap_drivers;
DROP POLICY IF EXISTS "Users can insert their own driver" ON public.one_lap_drivers;
DROP POLICY IF EXISTS "Users can update their own training" ON public.one_lap_drivers;

DROP POLICY IF EXISTS "Rooms viewable by everyone" ON public.one_lap_rooms;
DROP POLICY IF EXISTS "Users can create rooms" ON public.one_lap_rooms;
DROP POLICY IF EXISTS "Creator can update room" ON public.one_lap_rooms;
DROP POLICY IF EXISTS "Users can update room status" ON public.one_lap_rooms;

DROP POLICY IF EXISTS "Room players viewable by everyone" ON public.one_lap_room_players;
DROP POLICY IF EXISTS "Users can join rooms" ON public.one_lap_room_players;
DROP POLICY IF EXISTS "Users can update their own status/strategy" ON public.one_lap_room_players;
DROP POLICY IF EXISTS "Users can delete their own player" ON public.one_lap_room_players;

-- 3. Re-create Policies

-- Drivers
CREATE POLICY "Drivers viewable by everyone" ON public.one_lap_drivers FOR SELECT USING (true);
CREATE POLICY "Users can insert their own driver" ON public.one_lap_drivers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own training" ON public.one_lap_drivers FOR UPDATE USING (auth.uid() = user_id);

-- Rooms
CREATE POLICY "Rooms viewable by everyone" ON public.one_lap_rooms FOR SELECT USING (true);
CREATE POLICY "Users can create rooms" ON public.one_lap_rooms FOR INSERT WITH CHECK (auth.uid() = created_by);
-- Allow creator to update (e.g. close room) AND allow participants to update (if needed for game logic, though usually not)
CREATE POLICY "Creator can update room" ON public.one_lap_rooms FOR UPDATE USING (auth.uid() = created_by);
-- Allow delete by creator
CREATE POLICY "Creator can delete room" ON public.one_lap_rooms FOR DELETE USING (auth.uid() = created_by);

-- Room Players
CREATE POLICY "Room players viewable by everyone" ON public.one_lap_room_players FOR SELECT USING (true);
CREATE POLICY "Users can join rooms" ON public.one_lap_room_players FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own status/strategy" ON public.one_lap_room_players FOR UPDATE USING (auth.uid() = user_id);
-- Allow users to leave (delete their own record)
CREATE POLICY "Users can delete their own player" ON public.one_lap_room_players FOR DELETE USING (auth.uid() = user_id);

-- 4. Grant permissions (idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.one_lap_drivers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.one_lap_rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.one_lap_room_players TO authenticated;
