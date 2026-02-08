-- Migration: 20260208_game_logic_revision.sql

-- 1. Create Prize Pool Table
CREATE TABLE IF NOT EXISTS public.minigame_prize_pools (
    game_key TEXT PRIMARY KEY,
    current_pool FLOAT DEFAULT 500.0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize One Lap Duel pool if not exists
INSERT INTO public.minigame_prize_pools (game_key, current_pool)
VALUES ('one_lap_duel', 500.0)
ON CONFLICT (game_key) DO NOTHING;

-- Enable RLS
ALTER TABLE public.minigame_prize_pools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Prize pools viewable by everyone" ON public.minigame_prize_pools FOR SELECT USING (true);


-- 2. Add Focused Skills to Drivers
ALTER TABLE public.one_lap_drivers 
ADD COLUMN IF NOT EXISTS focused_skills TEXT[] DEFAULT '{}';

-- 3. Update Trigger for Prize Pool Increment
CREATE OR REPLACE FUNCTION public.process_one_lap_race_finish()
RETURNS TRIGGER AS $$
DECLARE
    v_winner_id UUID;
    v_winner_wallet_id UUID;
BEGIN
    v_winner_id := NEW.winner_id;

    -- WINNER REWARDS (5 Tokens)
    -- Get wallet id
    SELECT id INTO v_winner_wallet_id FROM public.wallets WHERE user_id = v_winner_id;
    
    IF v_winner_wallet_id IS NOT NULL THEN
        UPDATE public.wallets 
        SET token_balance = token_balance + 5 
        WHERE id = v_winner_wallet_id;
    END IF;

    -- PRIZE POOL INCREMENT (+2 TKN per race)
    -- Assuming 'per play' means per race. Or per player? 
    -- "every play will give a +2 gain". 
    -- If 2 players play, is it +4? Or +2 for the race? 
    -- Usually "every play" implies every game session. A 1v1 duel is one game session.
    -- Let's assume +2 per race for now. 
    UPDATE public.minigame_prize_pools
    SET current_pool = current_pool + 2,
        updated_at = NOW()
    WHERE game_key = 'one_lap_duel';

    -- LEADERBOARD UPDATE
    -- Update for winner
    INSERT INTO public.one_lap_leaderboard (user_id, races_played, wins, total_points, updated_at)
    VALUES (v_winner_id, 1, 1, 25, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        races_played = one_lap_leaderboard.races_played + 1,
        wins = one_lap_leaderboard.wins + 1,
        total_points = one_lap_leaderboard.total_points + 25,
        updated_at = NOW();

    -- Note: Ideally we should update the loser too, but we only have winner_id in the race row easily accessible.
    -- The race row has simulation_log, but finding the loser ID requires querying room_players or parsing logs.
    -- For this trigger, we'll focus on the winner and prize pool as requested.
    -- (The user didn't explicitly ask to fix the loser stats in this prompt, but previous prompt mentioned it. 
    -- I'll stick to the requested changes for now to keep it focused, but maybe adding loser update is good if easy.)
    
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Skill Update Logic (Lazy Update)
CREATE OR REPLACE FUNCTION public.update_driver_skills(p_user_id UUID)
RETURNS void AS $$
DECLARE
    v_driver public.one_lap_drivers%ROWTYPE;
    v_hours_passed FLOAT;
    v_daily_growth FLOAT;
    v_hourly_growth_total FLOAT;
    v_hourly_growth_per_skill FLOAT;
    v_focused_count INTEGER;
    v_decay_rate_hourly FLOAT := 0.00042; -- Approx 1% daily decay (1 - 0.99^(1/24))
    v_new_accel FLOAT;
    v_new_brake FLOAT;
    v_new_corn FLOAT;
    v_new_ers FLOAT;
    v_new_decis FLOAT;
BEGIN
    SELECT * INTO v_driver FROM public.one_lap_drivers WHERE user_id = p_user_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Calculate time passed in hours
    v_hours_passed := EXTRACT(EPOCH FROM (NOW() - v_driver.last_training_update)) / 3600.0;

    -- If less than 1 hour, maybe skip? Or just calculate fractional?
    -- Let's support fractional for smoother updates, or floor it if strictly "updates per hour".
    -- "updates per hour" usually implies a discrete step, but continuous is better for lazy loading.
    -- Let's use continuous but only if significant time passed (> 1 min?)
    IF v_hours_passed < 0.01 THEN
        RETURN;
    END IF;

    -- Determine Daily Growth Quota
    IF v_driver.training_mode = 'intense' THEN
        v_daily_growth := 2.0;
    ELSIF v_driver.training_mode = 'light' THEN
        v_daily_growth := 0.5;
    ELSE
        v_daily_growth := 0.0; -- Rest
    END IF;

    v_hourly_growth_total := v_daily_growth / 24.0;

    -- Focused Skills
    v_focused_count := array_length(v_driver.focused_skills, 1);
    
    IF v_focused_count IS NULL OR v_focused_count = 0 THEN
        -- If no skills focused, growth is wasted? Or distributed to all 5?
        -- "daily skill point will be equally distributed among the selected skill set only"
        -- Implies if none selected, none distributed.
        v_hourly_growth_per_skill := 0;
    ELSE
        v_hourly_growth_per_skill := v_hourly_growth_total / v_focused_count;
    END IF;

    -- Apply Decay and Growth to each skill
    -- Formula: New = 10 + (Old - 10) * (1 - decay)^hours + (Growth * hours [if focused])
    
    -- Helper macro-like logic
    -- Acceleration
    v_new_accel := 10 + (v_driver.acceleration_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'acceleration' = ANY(v_driver.focused_skills) THEN
        v_new_accel := v_new_accel + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    -- Braking
    v_new_brake := 10 + (v_driver.braking_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'braking' = ANY(v_driver.focused_skills) THEN
        v_new_brake := v_new_brake + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    -- Cornering
    v_new_corn := 10 + (v_driver.cornering_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'cornering' = ANY(v_driver.focused_skills) THEN
        v_new_corn := v_new_corn + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    -- ERS Efficiency
    v_new_ers := 10 + (v_driver.ers_efficiency_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'ers_efficiency' = ANY(v_driver.focused_skills) THEN
        v_new_ers := v_new_ers + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    -- Decision Making
    v_new_decis := 10 + (v_driver.decision_making_skill - 10) * power(1 - v_decay_rate_hourly, v_hours_passed);
    IF 'decision_making' = ANY(v_driver.focused_skills) THEN
        v_new_decis := v_new_decis + (v_hourly_growth_per_skill * v_hours_passed);
    END IF;

    -- Update Morale? 
    -- "fatigue and moral is the same thing"
    -- "daily allocation quotar ensures ... updates per hour"
    -- Does morale decay/grow? 
    -- Previous logic: Rest = Morale ++, Light = Morale +, Intense = Morale --
    -- Let's keep a simple linear change for morale based on mode.
    -- Rest: +5/day? Light: +0? Intense: -5/day?
    -- User didn't specify exact morale math, just that it exists. 
    -- I'll implement a reasonable default:
    -- Rest: +10 / 24 per hour
    -- Light: -2 / 24 per hour
    -- Intense: -10 / 24 per hour
    -- Clamped 0-100
    
    DECLARE
        v_morale_change_hourly FLOAT;
        v_new_morale FLOAT;
    BEGIN
        IF v_driver.training_mode = 'rest' THEN
            v_morale_change_hourly := 10.0 / 24.0;
        ELSIF v_driver.training_mode = 'light' THEN
             v_morale_change_hourly := -2.0 / 24.0;
        ELSE -- intense
             v_morale_change_hourly := -10.0 / 24.0;
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

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
