-- Enable RLS and switch One Lap Duel leaderboard to best time gap metric (seconds)

-- 1) Ensure RLS is enabled and public read policy exists on leaderboard
ALTER TABLE public.one_lap_leaderboard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leaderboard viewable by everyone" ON public.one_lap_leaderboard;

CREATE POLICY "Leaderboard viewable by everyone"
ON public.one_lap_leaderboard
FOR SELECT
USING (true);

GRANT SELECT ON public.one_lap_leaderboard TO authenticated;

-- 2) Add best_gap_sec column (signed time gap in seconds; more negative = better)
ALTER TABLE public.one_lap_leaderboard
ADD COLUMN IF NOT EXISTS best_gap_sec NUMERIC;

-- 3) Update race finish trigger to write best_gap_m instead of best_lap_time_ms
CREATE OR REPLACE FUNCTION public.process_one_lap_race_finish()
RETURNS TRIGGER AS $$
DECLARE
    v_winner_id UUID;
    v_loser_id UUID;
    v_room_id UUID;
    v_race_time_sec NUMERIC;
    v_race_time_ms INTEGER;
    v_logs JSONB;
    v_first_log JSONB;
    v_last_log JSONB;
    v_winner_wallet_id UUID;
    
    v_p1_id UUID;
    v_p2_id UUID;
    v_p1_start_dist NUMERIC;
    v_p2_start_dist NUMERIC;
    v_p1_end_dist NUMERIC;
    v_p2_end_dist NUMERIC;
    v_winner_is_p1 BOOLEAN;
    
    v_gap_dist NUMERIC;
    v_gap_winner NUMERIC;
    v_gap_loser NUMERIC;
    v_leader_speed_kmh NUMERIC;
    v_leader_speed_ms NUMERIC;
    v_gap_time_sec NUMERIC;
    v_base_points INTEGER;
    v_multiplier INTEGER := 1;
    v_final_points INTEGER;
BEGIN
    v_winner_id := new.winner_id;
    v_room_id := new.room_id;
    v_logs := new.simulation_log;
    
    -- Identify P1 and P2
    SELECT user_id INTO v_p1_id FROM public.one_lap_room_players WHERE room_id = v_room_id ORDER BY joined_at ASC LIMIT 1;
    SELECT user_id INTO v_p2_id FROM public.one_lap_room_players WHERE room_id = v_room_id ORDER BY joined_at ASC OFFSET 1 LIMIT 1;
    
    v_winner_is_p1 := (v_winner_id = v_p1_id);
    v_loser_id := CASE WHEN v_winner_is_p1 THEN v_p2_id ELSE v_p1_id END;

    -- Analyze Logs
    v_first_log := v_logs->0;
    v_last_log := v_logs->-1;
    
    v_race_time_sec := (v_last_log->>'time')::NUMERIC;
    v_race_time_ms := (v_race_time_sec * 1000)::INTEGER;

    v_p1_start_dist := (v_first_log->>'p1_dist')::NUMERIC;
    v_p2_start_dist := (v_first_log->>'p2_dist')::NUMERIC;
    
    v_p1_end_dist := (v_last_log->>'p1_dist')::NUMERIC;
    v_p2_end_dist := (v_last_log->>'p2_dist')::NUMERIC;

    -- Leader finish speed (for converting distance gap to time gap)
    IF v_winner_is_p1 THEN
        v_leader_speed_kmh := (v_last_log->>'p1_speed')::NUMERIC;
    ELSE
        v_leader_speed_kmh := (v_last_log->>'p2_speed')::NUMERIC;
    END IF;
    v_leader_speed_ms := v_leader_speed_kmh / 3.6;

    -- Absolute distance gap at finish
    v_gap_dist := ABS(v_p1_end_dist - v_p2_end_dist);

    -- Convert to time gap (seconds). If speed is zero, treat gap as 0s to avoid division by zero.
    IF v_leader_speed_ms > 0 THEN
        v_gap_time_sec := v_gap_dist / v_leader_speed_ms;
    ELSE
        v_gap_time_sec := 0;
    END IF;

    -- Signed gaps from each driver's perspective (seconds):
    -- gap = opponent_time - self_time
    -- -> winner has negative gap (ahead), loser has positive gap (behind)
    IF v_winner_is_p1 THEN
        v_gap_winner := -v_gap_time_sec;
        v_gap_loser  := v_gap_time_sec;
    ELSE
        v_gap_winner := -v_gap_time_sec;
        v_gap_loser  := v_gap_time_sec;
    END IF;
    
    -- Calculate Base Points (Gap Tier) using distance gap
    IF v_gap_dist < 20 THEN
        v_base_points := 5; -- Close Race
    ELSIF v_gap_dist < 50 THEN
        v_base_points := 4;
    ELSIF v_gap_dist < 100 THEN
        v_base_points := 3;
    ELSE
        v_base_points := 2; -- Easy Win
    END IF;

    -- Calculate Multiplier (Worse Grid Start)
    -- If Winner started BEHIND (smaller start distance), x2
    IF v_winner_is_p1 THEN
        IF v_p1_start_dist < v_p2_start_dist THEN
            v_multiplier := 2;
        END IF;
    ELSE
        -- Winner is P2
        IF v_p2_start_dist < v_p1_start_dist THEN
            v_multiplier := 2;
        END IF;
    END IF;

    v_final_points := v_base_points * v_multiplier;

    -- 1. WINNER REWARDS (5 Tokens - Fixed Reward)
    SELECT id INTO v_winner_wallet_id FROM public.wallets WHERE user_id = v_winner_id;
    
    IF v_winner_wallet_id IS NOT NULL THEN
        UPDATE public.wallets 
        SET token_balance = token_balance + 5
        WHERE id = v_winner_wallet_id;
        
        INSERT INTO public.ledger_entries (
            wallet_id, amount, currency, operation_type, reference_id, description
        ) VALUES (
            v_winner_wallet_id, 5, 'TOKEN', 'WIN', new.id, 'Victory in One Lap Duel'
        );
    END IF;
    
    -- Prize Pool
    INSERT INTO public.minigame_prize_pools (game_key, current_pool, updated_at)
    VALUES ('one_lap_duel', 2, NOW())
    ON CONFLICT (game_key) DO
      UPDATE SET 
        current_pool = public.minigame_prize_pools.current_pool + EXCLUDED.current_pool,
        updated_at = NOW();

    -- 2. LEADERBOARD UPDATE (Winner)
    INSERT INTO public.one_lap_leaderboard (user_id, best_gap_sec, races_played, wins, total_points, updated_at)
    VALUES (
        v_winner_id, 
        v_gap_winner, 
        1, 
        1, 
        v_final_points, 
        NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        races_played = one_lap_leaderboard.races_played + 1,
        wins = one_lap_leaderboard.wins + 1,
        total_points = one_lap_leaderboard.total_points + EXCLUDED.total_points,
        best_gap_sec = CASE 
            WHEN one_lap_leaderboard.best_gap_sec IS NULL OR EXCLUDED.best_gap_sec < one_lap_leaderboard.best_gap_sec 
            THEN EXCLUDED.best_gap_sec 
            ELSE one_lap_leaderboard.best_gap_sec 
        END,
        updated_at = NOW();

    -- 3. LEADERBOARD UPDATE (Loser)
    -- 0 Points for Loser (User Request)
    IF v_loser_id IS NOT NULL THEN
        INSERT INTO public.one_lap_leaderboard (user_id, best_gap_sec, races_played, wins, total_points, updated_at)
        VALUES (
            v_loser_id, 
            v_gap_loser, 
            1, 
            0, 
            0, -- 0 Points
            NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
            races_played = one_lap_leaderboard.races_played + 1,
            best_gap_sec = CASE 
                WHEN one_lap_leaderboard.best_gap_sec IS NULL OR EXCLUDED.best_gap_sec < one_lap_leaderboard.best_gap_sec 
                THEN EXCLUDED.best_gap_sec 
                ELSE one_lap_leaderboard.best_gap_sec 
            END,
            updated_at = NOW();
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4) Auto-delete empty rooms when last player exits
CREATE OR REPLACE FUNCTION public.cleanup_empty_one_lap_room()
RETURNS TRIGGER AS $$
BEGIN
    -- If the room still exists and has no players left, delete it
    IF EXISTS (SELECT 1 FROM public.one_lap_rooms WHERE id = OLD.room_id) AND
       NOT EXISTS (SELECT 1 FROM public.one_lap_room_players WHERE room_id = OLD.room_id) THEN
        DELETE FROM public.one_lap_rooms WHERE id = OLD.room_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_cleanup_empty_one_lap_room ON public.one_lap_room_players;

CREATE TRIGGER trg_cleanup_empty_one_lap_room
AFTER DELETE ON public.one_lap_room_players
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_empty_one_lap_room();
