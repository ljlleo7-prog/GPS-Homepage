-- Create a secure function to ensure wallet exists for ANY user (Security Definer)
CREATE OR REPLACE FUNCTION public.ensure_wallet_for_user(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
    v_wallet_id UUID;
BEGIN
    -- Check if wallet exists
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = p_user_id;
    
    IF v_wallet_id IS NOT NULL THEN
        RETURN v_wallet_id;
    END IF;

    -- Ensure Profile exists first (just in case)
    INSERT INTO public.profiles (id) VALUES (p_user_id) ON CONFLICT (id) DO NOTHING;

    -- Create wallet
    INSERT INTO public.wallets (user_id, token_balance, reputation_balance)
    VALUES (p_user_id, 1000, 60)
    RETURNING id INTO v_wallet_id;
    
    -- Log initial ledger entry
    INSERT INTO public.ledger_entries (
        wallet_id, amount, currency, operation_type, description
    ) VALUES (
        v_wallet_id, 1000, 'TOKEN', 'MINT', 'Initial Sign-up Bonus'
    );
    
    INSERT INTO public.ledger_entries (
        wallet_id, amount, currency, operation_type, description
    ) VALUES (
        v_wallet_id, 60, 'REP', 'MINT', 'Initial Reputation'
    );

    RETURN v_wallet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update Race Finish Logic to use ensure_wallet_for_user
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
    -- Ensure wallet exists
    v_winner_wallet_id := public.ensure_wallet_for_user(v_winner_id);
    
    UPDATE public.wallets 
    SET token_balance = token_balance + 5
    WHERE id = v_winner_wallet_id;
    
    INSERT INTO public.ledger_entries (
        wallet_id, amount, currency, operation_type, reference_id, description
    ) VALUES (
        v_winner_wallet_id, 5, 'TOKEN', 'REWARD', new.id, 'Victory in One Lap Duel'
    );

    -- 2. LEADERBOARD UPDATES
    -- Winner
    INSERT INTO public.one_lap_leaderboard (user_id, wins, total_races, best_lap_time_ms, total_points)
    VALUES (v_winner_id, 1, 1, v_race_time_ms, v_final_points + 25) -- 25 points for win + gap points
    ON CONFLICT (user_id) DO UPDATE SET
        wins = one_lap_leaderboard.wins + 1,
        total_races = one_lap_leaderboard.total_races + 1,
        best_lap_time_ms = LEAST(one_lap_leaderboard.best_lap_time_ms, EXCLUDED.best_lap_time_ms),
        total_points = one_lap_leaderboard.total_points + EXCLUDED.total_points;

    -- Loser (No points)
    INSERT INTO public.one_lap_leaderboard (user_id, wins, total_races, best_lap_time_ms, total_points)
    VALUES (v_loser_id, 0, 1, 99999999, 0)
    ON CONFLICT (user_id) DO UPDATE SET
        total_races = one_lap_leaderboard.total_races + 1;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
