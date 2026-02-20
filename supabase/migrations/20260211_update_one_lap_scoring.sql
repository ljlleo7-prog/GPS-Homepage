-- Update Race Finish Logic (Time Gap Points + Driver Stats + Leaderboard + Prize Pool)
-- This replaces the previous logic to ensure consistent server-side updates.

CREATE OR REPLACE FUNCTION public.process_one_lap_race_finish()
RETURNS TRIGGER AS $$
DECLARE
    v_winner_id UUID;
    v_loser_id UUID;
    v_room_id UUID;
    v_logs JSONB;
    v_last_log JSONB;
    v_winner_wallet_id UUID;
    
    v_p1_id UUID;
    v_p2_id UUID;
    v_winner_is_p1 BOOLEAN;
    
    v_p1_dist NUMERIC;
    v_p2_dist NUMERIC;
    v_loser_speed NUMERIC;
    v_gap_dist NUMERIC;
    v_time_gap NUMERIC;
    
    v_points INTEGER := 0;
    v_multiplier INTEGER := 1;
    v_total_points INTEGER;
    
    v_p1_start NUMERIC;
    v_p2_start NUMERIC;
BEGIN
    v_winner_id := new.winner_id;
    v_room_id := new.room_id;
    v_logs := new.simulation_log;
    
    -- Identify P1 and P2 from room players
    SELECT user_id INTO v_p1_id FROM public.one_lap_room_players WHERE room_id = v_room_id ORDER BY joined_at ASC LIMIT 1;
    SELECT user_id INTO v_p2_id FROM public.one_lap_room_players WHERE room_id = v_room_id ORDER BY joined_at ASC OFFSET 1 LIMIT 1;
    
    v_winner_is_p1 := (v_winner_id = v_p1_id);
    v_loser_id := CASE WHEN v_winner_is_p1 THEN v_p2_id ELSE v_p1_id END;

    -- Analyze Logs
    v_last_log := v_logs->-1;
    
    v_p1_dist := (v_last_log->>'p1_dist')::NUMERIC;
    v_p2_dist := (v_last_log->>'p2_dist')::NUMERIC;
    
    -- Calculate Gap
    v_gap_dist := ABS(v_p1_dist - v_p2_dist);
    
    -- Get Loser Speed for Time Gap (km/h from logs)
    IF v_winner_is_p1 THEN
        v_loser_speed := (v_last_log->>'p2_speed')::NUMERIC;
    ELSE
        v_loser_speed := (v_last_log->>'p1_speed')::NUMERIC;
    END IF;
    
    -- Convert speed to m/s (min 5 m/s)
    v_loser_speed := GREATEST(5, v_loser_speed / 3.6);
    v_time_gap := v_gap_dist / v_loser_speed;
    
    -- Calculate Points (Time Gap Tier)
    IF v_time_gap < 0.2 THEN v_points := 1;
    ELSIF v_time_gap < 0.5 THEN v_points := 2;
    ELSIF v_time_gap < 1.0 THEN v_points := 3;
    ELSIF v_time_gap < 2.0 THEN v_points := 4;
    ELSE v_points := 5;
    END IF;
    
    -- Grid Multiplier Check
    -- Check start distances from first log
    v_p1_start := (v_logs->0->>'p1_dist')::NUMERIC;
    v_p2_start := (v_logs->0->>'p2_dist')::NUMERIC;
    
    -- If P1 won and started BEHIND P2 (smaller dist means further back? No, dist increases)
    -- P1 starts at 0 or 10.
    -- If P1 starts at 0 and P2 at 10. P1 is behind.
    -- If P1 wins, multiplier 2.
    -- v_p1_start < v_p2_start means P1 started behind.
    IF v_winner_is_p1 AND v_p1_start < v_p2_start THEN v_multiplier := 2; END IF;
    IF NOT v_winner_is_p1 AND v_p2_start < v_p1_start THEN v_multiplier := 2; END IF;
    
    v_total_points := v_points * v_multiplier;
    
    -- 1. WINNER REWARDS (5 Tokens)
    SELECT id INTO v_winner_wallet_id FROM public.wallets WHERE user_id = v_winner_id;
    IF v_winner_wallet_id IS NOT NULL THEN
        UPDATE public.wallets SET token_balance = token_balance + 5 WHERE id = v_winner_wallet_id;
        INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, reference_id, description)
        VALUES (v_winner_wallet_id, 5, 'TOKEN', 'WIN', new.id, 'Victory in One Lap Duel');
    END IF;
    
    -- Prize Pool
    INSERT INTO public.minigame_prize_pools (game_key, current_pool, updated_at)
    VALUES ('one_lap_duel', 2, NOW())
    ON CONFLICT (game_key) DO UPDATE SET current_pool = public.minigame_prize_pools.current_pool + 2, updated_at = NOW();

    -- 2. UPDATE DRIVER STATS (Winner)
    -- Store negative gap for "Best Gap" (smaller is better, so -5.0 < -0.1 is wrong for "better")
    -- Wait, Leaderboard sorts "smaller is better".
    -- If we store -TimeGap. -5.0 vs -0.1.
    -- -5.0 is smaller than -0.1.
    -- If "smaller is better" means "Most Negative", then -5.0 is best.
    -- This aligns with "Big Win is Best".
    -- If "smaller is better" means "Closest to Zero", then -0.1 is best.
    -- User said: "sort by best gap (smaller the better)".
    -- In typical racing, "Gap to Leader" is positive. Smaller gap = Closer race.
    -- But here we track "Best Gap" for the WINNER.
    -- Winner's gap is margin of victory.
    -- Usually bigger margin is better performance.
    -- But if the user wants "smaller is better", maybe they want CLOSE races to be top?
    -- OR, they mean "Time". Lower lap time is better.
    -- But this is Gap.
    -- Let's stick to the Client logic I saw: `currentGap = -timeGap`.
    -- This implies storing negative numbers.
    -- If the leaderboard sorts ASC, then -5.0 comes before -0.1.
    -- So -5.0 is "Rank 1".
    -- This means Big Win is Rank 1.
    -- This makes sense.
    
    UPDATE public.one_lap_drivers 
    SET wins = COALESCE(wins, 0) + 1,
        points = COALESCE(points, 0) + v_total_points,
        best_gap_sec = LEAST(COALESCE(best_gap_sec, 999), -v_time_gap)
    WHERE user_id = v_winner_id;
    
    -- 3. UPDATE DRIVER STATS (Loser)
    UPDATE public.one_lap_drivers 
    SET losses = COALESCE(losses, 0) + 1
    WHERE user_id = v_loser_id;

    -- 4. UPDATE LEADERBOARD (Sync from Driver)
    PERFORM public.update_leaderboard_from_driver(v_winner_id);
    PERFORM public.update_leaderboard_from_driver(v_loser_id);

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
