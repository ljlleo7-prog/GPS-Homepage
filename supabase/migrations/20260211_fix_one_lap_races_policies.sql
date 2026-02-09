-- Fix RLS policies for one_lap_races to allow race inserts and public reads

-- Drop existing race policies to avoid conflicts
DROP POLICY IF EXISTS "Races viewable by everyone" ON public.one_lap_races;
DROP POLICY IF EXISTS "Public Read" ON public.one_lap_races;
DROP POLICY IF EXISTS "Public Read Races" ON public.one_lap_races;
DROP POLICY IF EXISTS "Participants can insert race results" ON public.one_lap_races;

-- Public read access (used for replays/leaderboards)
CREATE POLICY "Public Read Races"
ON public.one_lap_races
FOR SELECT
USING (true);

-- Allow room participants to insert race results
CREATE POLICY "Participants can insert race results"
ON public.one_lap_races
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.one_lap_room_players rp
    WHERE rp.room_id = one_lap_races.room_id
      AND rp.user_id = auth.uid()
  )
);

-- Ensure authenticated clients have base privileges
GRANT SELECT, INSERT ON public.one_lap_races TO authenticated;

