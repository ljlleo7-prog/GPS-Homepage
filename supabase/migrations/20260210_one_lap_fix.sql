-- Fix Driver Skills Update (Handle NULL last_training_update)
CREATE OR REPLACE FUNCTION public.update_driver_skills(p_user_id UUID)
RETURNS void AS $$
DECLARE
    v_driver public.one_lap_drivers%ROWTYPE;
    v_hours_passed FLOAT;
    v_daily_growth FLOAT;
    v_hourly_growth_total FLOAT;
    v_hourly_growth_per_skill FLOAT;
    v_focused_count INTEGER;
    v_decay_rate_hourly FLOAT := 0.00042;
    v_new_accel FLOAT;
    v_new_brake FLOAT;
    v_new_corn FLOAT;
    v_new_ers FLOAT;
    v_new_decis FLOAT;
    v_morale_change_hourly FLOAT;
    v_new_morale FLOAT;
BEGIN
    SELECT * INTO v_driver FROM public.one_lap_drivers WHERE user_id = p_user_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- FIX: Handle NULL last_training_update by initializing it to NOW() and returning (first run)
    IF v_driver.last_training_update IS NULL THEN
        UPDATE public.one_lap_drivers SET last_training_update = NOW() WHERE user_id = p_user_id;
        RETURN;
    END IF;

    v_hours_passed := EXTRACT(EPOCH FROM (NOW() - v_driver.last_training_update)) / 3600.0;

    -- Prevent too frequent updates or weird time jumps
    IF v_hours_passed < 0.01 THEN
        RETURN;
    END IF;

    IF v_driver.training_mode = 'intense' THEN
        v_daily_growth := 2.0;
    ELSIF v_driver.training_mode = 'light' THEN
        v_daily_growth := 0.5;
    ELSE
        v_daily_growth := 0.0;
    END IF;

    v_hourly_growth_total := v_daily_growth / 24.0;
    v_focused_count := array_length(v_driver.focused_skills, 1);
    
    IF v_focused_count IS NULL OR v_focused_count = 0 THEN
        v_hourly_growth_per_skill := 0;
    ELSE
        v_hourly_growth_per_skill := v_hourly_growth_total / v_focused_count;
    END IF;

    -- Decay & Growth Logic
    v_new_accel := 10 + (v_driver.acceleration_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'acceleration' = ANY(v_driver.focused_skills) THEN
        v_new_accel := v_new_accel + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    v_new_brake := 10 + (v_driver.braking_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'braking' = ANY(v_driver.focused_skills) THEN
        v_new_brake := v_new_brake + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    v_new_corn := 10 + (v_driver.cornering_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'cornering' = ANY(v_driver.focused_skills) THEN
        v_new_corn := v_new_corn + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    v_new_ers := 10 + (v_driver.ers_efficiency_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'ers_efficiency' = ANY(v_driver.focused_skills) THEN
        v_new_ers := v_new_ers + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    v_new_decis := 10 + (v_driver.decision_making_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'decision_making' = ANY(v_driver.focused_skills) THEN
        v_new_decis := v_new_decis + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    -- Morale
    IF v_driver.training_mode = 'intense' THEN
        v_morale_change_hourly := -1.0 / 24.0; -- -1 per day
    ELSIF v_driver.training_mode = 'light' THEN
        v_morale_change_hourly := 0.2 / 24.0; -- +0.2 per day
    ELSE
        v_morale_change_hourly := 1.0 / 24.0; -- +1 per day
    END IF;
    
    v_new_morale := v_driver.morale + (v_morale_change_hourly * v_hours_passed);
    IF v_new_morale > 100 THEN v_new_morale := 100; END IF;
    IF v_new_morale < 0 THEN v_new_morale := 0; END IF;
    
    UPDATE public.one_lap_drivers
    SET 
        acceleration_skill = v_new_accel,
        braking_skill = v_new_brake,
        cornering_skill = v_new_corn,
        ers_efficiency_skill = v_new_ers,
        decision_making_skill = v_new_decis,
        morale = v_new_morale,
        last_training_update = NOW()
    WHERE user_id = p_user_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Update Race Finish Logic (Gap Points + Grid Multiplier)
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

    -- Calculate Gap (Distance)
    v_gap_dist := ABS(v_p1_end_dist - v_p2_end_dist);
    
    -- Calculate Base Points (Gap Tier)
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
            v_winner_wallet_id, 5, 'TOKEN', 'REWARD', new.id, 'Victory in One Lap Duel'
        );
    END IF;
    
    -- Prize Pool
    UPDATE public.minigame_prize_pools
    SET current_pool = current_pool + 2,
        updated_at = NOW()
    WHERE game_key = 'one_lap_duel';

    -- 2. LEADERBOARD UPDATE (Winner)
    INSERT INTO public.one_lap_leaderboard (user_id, best_lap_time_ms, races_played, wins, total_points, updated_at)
    VALUES (
        v_winner_id, 
        v_race_time_ms, 
        1, 
        1, 
        v_final_points, 
        NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        races_played = one_lap_leaderboard.races_played + 1,
        wins = one_lap_leaderboard.wins + 1,
        total_points = one_lap_leaderboard.total_points + EXCLUDED.total_points, -- Add points
        best_lap_time_ms = CASE 
            WHEN one_lap_leaderboard.best_lap_time_ms IS NULL OR EXCLUDED.best_lap_time_ms < one_lap_leaderboard.best_lap_time_ms 
            THEN EXCLUDED.best_lap_time_ms 
            ELSE one_lap_leaderboard.best_lap_time_ms 
        END,
        updated_at = NOW();

    -- 3. LEADERBOARD UPDATE (Loser)
    -- 0 Points for Loser (User Request)
    IF v_loser_id IS NOT NULL THEN
        INSERT INTO public.one_lap_leaderboard (user_id, best_lap_time_ms, races_played, wins, total_points, updated_at)
        VALUES (
            v_loser_id, 
            NULL, 
            1, 
            0, 
            0, -- 0 Points
            NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
            races_played = one_lap_leaderboard.races_played + 1,
            -- No points added
            updated_at = NOW();
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
