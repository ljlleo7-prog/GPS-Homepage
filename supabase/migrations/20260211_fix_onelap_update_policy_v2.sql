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
CREATE POLICY "Prize pools updatable" ON public.minigame_prize_pools FOR UPDATE USING (true) WITH CHECK (true);

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

-- 5. Inactivity enforcement for room players
CREATE OR REPLACE FUNCTION public.enforce_one_lap_room_inactivity()
RETURNS void AS $$
BEGIN
    -- Prepared -> Preparing after 5 minutes of inactivity
    UPDATE public.one_lap_room_players rp
    SET is_ready = FALSE
    WHERE rp.is_ready = TRUE
      AND rp.last_active_at IS NOT NULL
      AND rp.last_active_at < NOW() - INTERVAL '5 minutes';

    -- Kick guests after 60 minutes of inactivity
    DELETE FROM public.one_lap_room_players rp
    USING public.one_lap_rooms r
    WHERE rp.room_id = r.id
      AND rp.last_active_at IS NOT NULL
      AND rp.last_active_at < NOW() - INTERVAL '60 minutes'
      AND rp.user_id <> r.created_by;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule enforcement to run every minute
SELECT cron.schedule(
    'onelap_room_inactivity',
    '* * * * *',
    $$ SELECT public.enforce_one_lap_room_inactivity() $$
);
