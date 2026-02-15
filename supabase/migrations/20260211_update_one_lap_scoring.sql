-- Migration to update One Lap Duel scoring logic to time-based tiers
-- and adjust multiplier logic.

CREATE OR REPLACE FUNCTION public.process_one_lap_race_finish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room_id UUID;
    v_winner_id UUID;
    v_loser_id UUID;
    v_p1_id UUID;
    v_p2_id UUID;
    v_winner_is_p1 BOOLEAN;
    v_logs JSONB;
    v_first_log JSONB;
    v_last_log JSONB;
    v_p1_start_dist NUMERIC;
    v_p2_start_dist NUMERIC;
    v_p1_end_dist NUMERIC;
    v_p2_end_dist NUMERIC;
    v_leader_speed_kmh NUMERIC;
    v_leader_speed_ms NUMERIC;
    v_gap_dist NUMERIC;
    v_gap_time_sec NUMERIC;
    v_gap_winner NUMERIC;
    v_gap_loser NUMERIC;
    v_base_points INTEGER;
    v_multiplier INTEGER := 1;
    v_final_points INTEGER;
    v_winner_wallet_id UUID;
    v_race_time_sec NUMERIC;
    v_race_time_ms INTEGER;
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
    
    -- Calculate Base Points (Time Gap Tier)
    -- <0.2s: 1pts (risky)
    -- 0.2-0.5s: 2pts
    -- 0.5-1s: 3pts
    -- 1-2s: 4pts
    -- >2s: 5pts (zoom-by)
    IF v_gap_time_sec < 0.2 THEN
        v_base_points := 1;
    ELSIF v_gap_time_sec < 0.5 THEN
        v_base_points := 2;
    ELSIF v_gap_time_sec < 1.0 THEN
        v_base_points := 3;
    ELSIF v_gap_time_sec < 2.0 THEN
        v_base_points := 4;
    ELSE
        v_base_points := 5;
    END IF;

    -- Calculate Multiplier (Overtake / Worse Grid Start)
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

    -- 2. UPDATE LEADERBOARD (Upsert)
    
    -- Winner
    INSERT INTO public.one_lap_leaderboard (user_id, wins, total_points, best_gap_sec, last_race_at)
    VALUES (v_winner_id, 1, v_final_points, v_gap_winner, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET wins = one_lap_leaderboard.wins + 1,
        total_points = one_lap_leaderboard.total_points + EXCLUDED.total_points,
        best_gap_sec = CASE 
            WHEN one_lap_leaderboard.best_gap_sec IS NULL 
                 OR EXCLUDED.best_gap_sec < one_lap_leaderboard.best_gap_sec 
            THEN EXCLUDED.best_gap_sec 
            ELSE one_lap_leaderboard.best_gap_sec 
        END,
        last_race_at = NOW();

    -- Loser (Update participation/points if we had loss points, but here just updating last_race and maybe gap?)
    -- Currently loser gets 0 points, but we should track their 'best_gap_sec' if they ever win? 
    -- Or maybe they just get an entry.
    -- Let's just update timestamp for loser for now, or insert if new.
    INSERT INTO public.one_lap_leaderboard (user_id, wins, total_points, best_gap_sec, last_race_at)
    VALUES (v_loser_id, 0, 0, 999999, NOW()) -- Dummy high gap if no wins yet
    ON CONFLICT (user_id) DO UPDATE
    SET last_race_at = NOW();

    -- 3. CLEANUP ROOM (Auto-delete room if needed, handled by separate trigger or UI? 
    -- Actually user asked for "complete exit" logic separately.
    -- Here we just record results.
    
    RETURN new;
END;
$$;
