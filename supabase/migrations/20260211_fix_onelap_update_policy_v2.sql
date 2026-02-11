-- 1. Ensure minigame_prize_pools table exists (Fixes potential Trigger crash)
CREATE TABLE IF NOT EXISTS public.minigame_prize_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_key TEXT UNIQUE NOT NULL,
    current_pool NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.minigame_prize_pools ENABLE ROW LEVEL SECURITY;

-- Allow read for everyone
DROP POLICY IF EXISTS "Prize pools viewable by everyone" ON public.minigame_prize_pools;
CREATE POLICY "Prize pools viewable by everyone" ON public.minigame_prize_pools FOR SELECT USING (true);

-- Seed one_lap_duel pool if missing
INSERT INTO public.minigame_prize_pools (game_key, current_pool)
VALUES ('one_lap_duel', 500)
ON CONFLICT (game_key) DO NOTHING;

-- 2. Open up one_lap_drivers for updates by any authenticated user
-- This is required because the HOST updates the GUEST's stats/wins on finish.
-- In a P2P architecture, we must trust the connected clients (or at least the host).
DROP POLICY IF EXISTS "Users can update their own training" ON public.one_lap_drivers;
DROP POLICY IF EXISTS "Authenticated users can update drivers" ON public.one_lap_drivers;

CREATE POLICY "Authenticated users can update drivers"
ON public.one_lap_drivers
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 3. Open up one_lap_leaderboard just in case (though updated by Trigger usually)
-- This ensures that if the Trigger fails, we might fall back or debug easier.
DROP POLICY IF EXISTS "Leaderboard viewable by everyone" ON public.one_lap_leaderboard;
CREATE POLICY "Leaderboard viewable by everyone" ON public.one_lap_leaderboard FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can update leaderboard" ON public.one_lap_leaderboard;
CREATE POLICY "Authenticated users can update leaderboard" 
ON public.one_lap_leaderboard 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- 4. Ensure one_lap_races allows insert
-- We relax the policy to ensure the Host can always insert results.
DROP POLICY IF EXISTS "Participants can insert race results" ON public.one_lap_races;
CREATE POLICY "Participants can insert race results" 
ON public.one_lap_races 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');
