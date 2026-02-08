-- FIX PERMISSIONS AND SEARCH PATHS (COMPREHENSIVE)
-- This migration fixes the "permission denied" issues by explicitly granting access 
-- to the profiles table and ensuring all SECURITY DEFINER functions have a safe search_path.

-- ==========================================
-- 1. GRANT PERMISSIONS
-- ==========================================

-- Profiles: Critical for everything
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Wallets: Users need to view their own
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;

-- Ledger: Users need to view their own
GRANT SELECT ON public.ledger_entries TO authenticated;
GRANT ALL ON public.ledger_entries TO service_role;

-- Grant EXECUTE on all functions to authenticated (standard Supabase pattern)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ==========================================
-- 2. FIX FUNCTIONS (SEARCH_PATH & SECURITY)
-- ==========================================

-- A. Handle New User (Trigger Function)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- 1. Create Profile
  INSERT INTO public.profiles (id, username, full_name, avatar_url, last_login)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'username', 
    new.raw_user_meta_data->>'full_name', 
    new.raw_user_meta_data->>'avatar_url',
    NOW()
  );
  
  -- 2. Create Wallet
  INSERT INTO public.wallets (id, user_id, token_balance, reputation_balance)
  VALUES (gen_random_uuid(), new.id, 100, 0); 
  
  RETURN new;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but raise to fail the transaction
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RAISE EXCEPTION 'Database error during user creation: %', SQLERRM;
END;
$$;

-- B. Developer Inbox (RPC)
CREATE OR REPLACE FUNCTION public.get_developer_inbox()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_is_dev BOOLEAN;
  v_pending_devs JSONB;
  v_pending_missions JSONB;
  v_active_bets JSONB;
  v_pending_acks JSONB;
  v_pending_tests JSONB;
BEGIN
  v_user_id := auth.uid();
  
  SELECT (COALESCE(developer_status, 'NONE') = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_is_dev IS NULL THEN v_is_dev := false; END IF;

  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  -- 1. Pending Developer Requests
  SELECT jsonb_agg(t) INTO v_pending_devs
  FROM (
    SELECT 
        id, 
        COALESCE(username, 'User_' || substr(id::text, 1, 8)) as username, 
        COALESCE(full_name, 'No Name') as full_name, 
        created_at
    FROM public.profiles
    WHERE developer_status = 'PENDING'
  ) t;

  -- 2. Pending Mission Submissions
  SELECT jsonb_agg(t) INTO v_pending_missions
  FROM (
    SELECT 
      s.id, s.content, s.created_at, 
      COALESCE(m.title, 'Unknown Mission') as mission_title,
      COALESCE(p.username, 'Unknown User') as submitter_name,
      s.user_id
    FROM public.mission_submissions s
    LEFT JOIN public.missions m ON s.mission_id = m.id
    LEFT JOIN public.profiles p ON s.user_id = p.id
    WHERE s.status = 'PENDING'
  ) t;

  -- 3. Active Bets
  SELECT jsonb_agg(t) INTO v_active_bets
  FROM (
    SELECT 
      i.id, i.title, i.description, i.official_end_date, i.side_a_name, i.side_b_name,
      COALESCE(p.username, 'Unknown User') as creator_name
    FROM public.support_instruments i
    LEFT JOIN public.profiles p ON i.creator_id = p.id
    WHERE i.is_driver_bet = true AND i.status != 'RESOLVED'
  ) t;

  -- 4. Forum Acks
  BEGIN
      SELECT jsonb_agg(t) INTO v_pending_acks
      FROM (
        SELECT f.id, f.title, f.created_at, COALESCE(p.username, 'Unknown User') as author_name
        FROM public.forum_posts f
        LEFT JOIN public.profiles p ON f.author_id = p.id
        WHERE f.is_acknowledgement_requested = true
      ) t;
  EXCEPTION WHEN OTHERS THEN v_pending_acks := '[]'::jsonb; END;

  -- 5. Test Requests
  SELECT jsonb_agg(t) INTO v_pending_tests
  FROM (
    SELECT r.id, r.identifiable_name, r.program, r.progress_description, r.created_at,
          COALESCE(p.username, 'Unknown User') as user_name,
          COALESCE(p.email, 'No Email') as user_email
      FROM public.test_player_requests r
      LEFT JOIN public.profiles p ON r.user_id = p.id
      WHERE r.status = 'PENDING'
  ) t;

  RETURN jsonb_build_object(
    'success', true,
    'pending_devs', COALESCE(v_pending_devs, '[]'::jsonb),
    'pending_missions', COALESCE(v_pending_missions, '[]'::jsonb),
    'active_bets', COALESCE(v_active_bets, '[]'::jsonb),
    'pending_acks', COALESCE(v_pending_acks, '[]'::jsonb),
    'pending_tests', COALESCE(v_pending_tests, '[]'::jsonb)
  );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', 'RPC Error: ' || SQLERRM);
END;
$$;

-- C. Minigame Leaderboard
CREATE OR REPLACE FUNCTION public.get_monthly_leaderboard(
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    best_score INTEGER,
    rank BIGINT,
    total_plays BIGINT,
    last_played_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH MonthlyScores AS (
        SELECT 
            ms.user_id,
            MIN(ms.score_ms) as best_score,
            COUNT(*) as play_count,
            MAX(ms.created_at) as last_played
        FROM public.minigame_scores ms
        WHERE 
            EXTRACT(YEAR FROM ms.created_at) = p_year
            AND EXTRACT(MONTH FROM ms.created_at) = p_month
            AND ms.game_type = 'REACTION'
        GROUP BY ms.user_id
    )
    SELECT 
        ms.user_id,
        COALESCE(p.username, 'Anonymous') as username,
        ms.best_score::INTEGER,
        RANK() OVER (ORDER BY ms.best_score ASC) as rank,
        ms.play_count,
        ms.last_played
    FROM MonthlyScores ms
    LEFT JOIN public.profiles p ON ms.user_id = p.id
    ORDER BY ms.best_score ASC
    LIMIT 100;
END;
$$;

-- D. Prize Pool
CREATE OR REPLACE FUNCTION public.get_monthly_prize_pool(
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_total_plays INTEGER;
    v_base_pool INTEGER := 500;
    v_token_per_play INTEGER := 2; 
    v_total_pool INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_plays
    FROM public.minigame_scores
    WHERE 
        EXTRACT(YEAR FROM created_at) = p_year
        AND EXTRACT(MONTH FROM created_at) = p_month
        AND game_type = 'REACTION';
        
    v_total_pool := v_base_pool + (v_total_plays * v_token_per_play);
    
    RETURN jsonb_build_object(
        'total_plays', v_total_plays,
        'base_pool', v_base_pool,
        'dynamic_pool', v_total_pool
    );
END;
$$;

-- E. One Lap Duel Race Finish
CREATE OR REPLACE FUNCTION public.process_one_lap_race_finish()
RETURNS TRIGGER AS $$
DECLARE
    v_winner_id UUID;
    v_winner_wallet_id UUID;
BEGIN
    v_winner_id := NEW.winner_id;

    -- WINNER REWARDS (5 Tokens)
    SELECT id INTO v_winner_wallet_id FROM public.wallets WHERE user_id = v_winner_id;
    
    IF v_winner_wallet_id IS NOT NULL THEN
        UPDATE public.wallets 
        SET token_balance = token_balance + 5 
        WHERE id = v_winner_wallet_id;
    END IF;

    -- PRIZE POOL INCREMENT (+2 TKN per race)
    UPDATE public.minigame_prize_pools
    SET current_pool = current_pool + 2,
        updated_at = NOW()
    WHERE game_key = 'one_lap_duel';

    -- LEADERBOARD UPDATE
    INSERT INTO public.one_lap_leaderboard (user_id, races_played, wins, total_points, updated_at)
    VALUES (v_winner_id, 1, 1, 25, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        races_played = one_lap_leaderboard.races_played + 1,
        wins = one_lap_leaderboard.wins + 1,
        total_points = one_lap_leaderboard.total_points + 25,
        updated_at = NOW();

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- F. One Lap Driver Skills Update
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

    v_hours_passed := EXTRACT(EPOCH FROM (NOW() - v_driver.last_training_update)) / 3600.0;

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

    IF v_driver.training_mode = 'rest' THEN
        v_morale_change_hourly := 10.0 / 24.0;
    ELSIF v_driver.training_mode = 'light' THEN
            v_morale_change_hourly := -2.0 / 24.0;
    ELSE
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- G. Mission Reward Update (Trigger)
CREATE OR REPLACE FUNCTION public.update_mission_reward()
RETURNS TRIGGER AS $$
DECLARE
  v_mission_id UUID;
  v_min NUMERIC;
  v_max NUMERIC;
  v_count INTEGER;
  v_new_reward NUMERIC;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_mission_id := OLD.mission_id;
  ELSE
    v_mission_id := NEW.mission_id;
  END IF;

  SELECT reward_min, reward_max INTO v_min, v_max
  FROM public.missions
  WHERE id = v_mission_id AND is_variable_reward = true;

  IF FOUND THEN
    SELECT count(*) INTO v_count
    FROM public.mission_submissions
    WHERE mission_id = v_mission_id AND status IN ('PENDING', 'APPROVED');

    IF v_count >= 10 THEN
      v_new_reward := v_min;
    ELSE
      v_new_reward := v_max - (v_count::NUMERIC * (v_max - v_min) / 10.0);
    END IF;

    v_new_reward := GREATEST(v_min, LEAST(v_max, v_new_reward));

    UPDATE public.missions
    SET reward_tokens = FLOOR(v_new_reward)
    WHERE id = v_mission_id;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- H. Create User Campaign
CREATE OR REPLACE FUNCTION public.create_user_campaign(
  p_type TEXT,
  p_title TEXT,
  p_description TEXT,
  p_reward_min NUMERIC DEFAULT 0,
  p_reward_max NUMERIC DEFAULT 0,
  p_yield_rate NUMERIC DEFAULT 0,
  p_lockup_days INTEGER DEFAULT 0
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_rep NUMERIC;
  v_new_id UUID;
BEGIN
  SELECT reputation_balance INTO v_rep
  FROM public.wallets
  WHERE user_id = v_user_id;

  IF v_rep IS NULL OR v_rep <= 70 THEN
    RAISE EXCEPTION 'Insufficient Reputation. Requires > 70 Rep.';
  END IF;

  IF p_type = 'MISSION' THEN
    INSERT INTO public.missions (
      title, description, reward_tokens, reward_rep, 
      is_variable_reward, reward_min, reward_max, 
      status, type, creator_id
    ) VALUES (
      p_title, p_description, p_reward_max, 5,
      true, p_reward_min, p_reward_max,
      'PENDING_APPROVAL', 'COMMUNITY', v_user_id
    ) RETURNING id INTO v_new_id;
    
    RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'MISSION');

  ELSIF p_type = 'MARKET' THEN
    INSERT INTO public.support_instruments (
      title, description, type, risk_level, 
      yield_rate, lockup_period_days, 
      status, creator_id
    ) VALUES (
      p_title, p_description, 'MILESTONE', 'HIGH',
      p_yield_rate, p_lockup_days,
      'PENDING', v_user_id
    ) RETURNING id INTO v_new_id;

    RETURN jsonb_build_object('success', true, 'id', v_new_id, 'type', 'MARKET');
    
  ELSE
    RAISE EXCEPTION 'Invalid campaign type';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ==========================================
-- 3. RE-VERIFY RLS POLICIES
-- ==========================================

-- Ensure Profiles are readable
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" 
ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
