-- Trigger function to handle race completion rewards and leaderboard updates
CREATE OR REPLACE FUNCTION public.process_one_lap_race_finish()
RETURNS TRIGGER AS $$
DECLARE
    v_winner_id UUID;
    v_loser_id UUID;
    v_room_id UUID;
    v_race_time_sec NUMERIC;
    v_race_time_ms INTEGER;
    v_logs JSONB;
    v_last_log JSONB;
    v_winner_wallet_id UUID;
BEGIN
    v_winner_id := new.winner_id;
    v_room_id := new.room_id;
    v_logs := new.simulation_log;
    
    -- Get Last Log Entry for Time
    -- JSONB array access: -> -1 gets the last element
    v_last_log := v_logs->-1;
    v_race_time_sec := (v_last_log->>'time')::NUMERIC;
    v_race_time_ms := (v_race_time_sec * 1000)::INTEGER;

    -- Find the Loser (The participant who is not the winner)
    SELECT user_id INTO v_loser_id
    FROM public.one_lap_room_players
    WHERE room_id = v_room_id AND user_id != v_winner_id
    LIMIT 1;

    -- 1. WINNER REWARDS (5 Tokens)
    SELECT id INTO v_winner_wallet_id FROM public.wallets WHERE user_id = v_winner_id;
    
    IF v_winner_wallet_id IS NOT NULL THEN
        -- Update Balance
        UPDATE public.wallets 
        SET token_balance = token_balance + 5
        WHERE id = v_winner_wallet_id;
        
        -- Ledger Entry
        INSERT INTO public.ledger_entries (
            wallet_id,
            amount,
            currency,
            operation_type,
            reference_id,
            description
        ) VALUES (
            v_winner_wallet_id,
            5,
            'TOKEN',
            'REWARD',
            new.id, -- Race ID
            'Victory in One Lap Duel'
        );
    END IF;

    -- 2. LEADERBOARD UPDATE (Winner)
    -- Upsert logic
    INSERT INTO public.one_lap_leaderboard (user_id, best_lap_time_ms, races_played, wins, total_points, updated_at)
    VALUES (
        v_winner_id, 
        v_race_time_ms, 
        1, -- races_played
        1, -- wins
        25, -- points (25 for win)
        NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        races_played = one_lap_leaderboard.races_played + 1,
        wins = one_lap_leaderboard.wins + 1,
        total_points = one_lap_leaderboard.total_points + 25,
        -- Update best time only if new time is better (lower) or old time is null
        best_lap_time_ms = CASE 
            WHEN one_lap_leaderboard.best_lap_time_ms IS NULL OR EXCLUDED.best_lap_time_ms < one_lap_leaderboard.best_lap_time_ms 
            THEN EXCLUDED.best_lap_time_ms 
            ELSE one_lap_leaderboard.best_lap_time_ms 
        END,
        updated_at = NOW();

    -- 3. LEADERBOARD UPDATE (Loser)
    IF v_loser_id IS NOT NULL THEN
        INSERT INTO public.one_lap_leaderboard (user_id, best_lap_time_ms, races_played, wins, total_points, updated_at)
        VALUES (
            v_loser_id, 
            NULL, -- Did not finish lap
            1, 
            0, 
            10, -- 10 points for participation
            NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
            races_played = one_lap_leaderboard.races_played + 1,
            total_points = one_lap_leaderboard.total_points + 10,
            updated_at = NOW();
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to allow clean re-apply
DROP TRIGGER IF EXISTS trigger_one_lap_race_finish ON public.one_lap_races;

-- Create Trigger
CREATE TRIGGER trigger_one_lap_race_finish
AFTER INSERT ON public.one_lap_races
FOR EACH ROW
EXECUTE FUNCTION public.process_one_lap_race_finish();
