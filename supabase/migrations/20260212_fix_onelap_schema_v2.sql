-- Add wins, losses, points to one_lap_drivers
ALTER TABLE public.one_lap_drivers
ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS best_gap_sec NUMERIC DEFAULT 999;

-- Create or Replace update_leaderboard_from_driver function
CREATE OR REPLACE FUNCTION public.update_leaderboard_from_driver(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    d_wins INTEGER;
    d_losses INTEGER;
    d_points INTEGER;
    d_best_gap NUMERIC;
BEGIN
    -- Get driver stats
    SELECT wins, losses, points, best_gap_sec INTO d_wins, d_losses, d_points, d_best_gap
    FROM public.one_lap_drivers
    WHERE user_id = p_user_id;

    -- Update or Insert into Leaderboard
    INSERT INTO public.one_lap_leaderboard (user_id, wins, total_points, races_played, best_gap_sec, updated_at)
    VALUES (p_user_id, d_wins, d_points, d_wins + d_losses, d_best_gap, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET wins = EXCLUDED.wins,
        total_points = EXCLUDED.total_points,
        races_played = EXCLUDED.races_played,
        best_gap_sec = EXCLUDED.best_gap_sec,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
