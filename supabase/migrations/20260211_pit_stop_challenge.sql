-- Migration: 20260211_pit_stop_challenge.sql

-- 1. Update Leaderboard Function to support Game Type
DROP FUNCTION IF EXISTS public.get_monthly_leaderboard(integer, integer);
CREATE OR REPLACE FUNCTION public.get_monthly_leaderboard(
    p_game_type TEXT,
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    avatar_url TEXT,
    best_score INTEGER,
    rank BIGINT,
    play_count BIGINT,
    last_played TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
            AND ms.game_type = p_game_type
        GROUP BY ms.user_id
    )
    SELECT 
        ms.user_id,
        COALESCE(p.username, 'Anonymous') as username,
        p.avatar_url,
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

-- 2. Update Prize Pool Function to support Game Type
DROP FUNCTION IF EXISTS public.get_monthly_prize_pool(integer, integer);
CREATE OR REPLACE FUNCTION public.get_monthly_prize_pool(
    p_game_type TEXT,
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        AND game_type = p_game_type;
        
    v_total_pool := v_base_pool + (v_total_plays * v_token_per_play);
    
    RETURN jsonb_build_object(
        'total_plays', v_total_plays,
        'base_pool', v_base_pool,
        'dynamic_pool', v_total_pool
    );
END;
$$;

-- 3. Create Play Function for Pit Stop Challenge
CREATE OR REPLACE FUNCTION public.play_pit_stop_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
  v_last_reward_time TIMESTAMPTZ;
  v_reward_amount NUMERIC := 0;
  v_score_id UUID;
  v_cooldown_remaining INTEGER := 0;
  v_on_cooldown BOOLEAN := false;
  v_cost CONSTANT INTEGER := 1;
  v_token_balance NUMERIC;
BEGIN
  -- 1. Get Wallet
  SELECT id, token_balance INTO v_wallet_id, v_token_balance 
  FROM public.wallets 
  WHERE user_id = v_user_id;
  
  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Wallet not found');
  END IF;

  -- 2. Check Balance
  IF v_token_balance < v_cost THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient tokens. Need 1 token to play.');
  END IF;

  -- 3. Deduct Cost
  UPDATE public.wallets 
  SET token_balance = token_balance - v_cost 
  WHERE id = v_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_wallet_id, -v_cost, 'TOKEN', 'GAME_COST', 'Pit Stop Challenge Entry Fee');

  -- 4. Record Score
  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount)
  VALUES (v_user_id, 'PIT_STOP', p_score_ms, 0)
  RETURNING id INTO v_score_id;

  -- 5. Check Reward Cooldown (60 mins) - Using a separate cooldown column for Pit Stop?
  -- Or share the same 'last_minigame_reward_at'? 
  -- "same policy" -> likely implies the same global minigame cooldown? 
  -- Or per-game cooldown? Usually per-game makes sense if they are distinct skills.
  -- But existing schema has `last_minigame_reward_at` on profile (single field).
  -- To support per-game cooldown, we'd need a new table or column.
  -- Given the prompt "feature the same... policy", I'll assume they SHARE the cooldown slot on Profile for simplicity unless otherwise specified.
  -- However, "Reaction Game" uses `last_minigame_reward_at`. If I play Pit Stop, should it block Reaction rewards?
  -- Probably yes, if it's a global "Minigame Reward Cooldown".
  -- Let's stick to the single `last_minigame_reward_at` for now.

  -- 6. Calculate Reward (Tiered)
    -- <2s -> 20 token
    -- 2-2.5s -> 10 token
    -- 2.5-3s -> 5 token
    -- 3-4s -> 2 token
    -- 4-6s -> 1 token
    -- >6s -> 0 token
    IF p_score_ms < 2000 THEN
        v_reward_amount := 20;
    ELSIF p_score_ms < 2500 THEN
        v_reward_amount := 10;
    ELSIF p_score_ms < 3000 THEN
        v_reward_amount := 5;
    ELSIF p_score_ms < 4000 THEN
        v_reward_amount := 2;
    ELSIF p_score_ms < 6000 THEN
        v_reward_amount := 1;
    ELSE
        v_reward_amount := 0;
    END IF;

  -- 7. Award Reward (If not on cooldown AND reward > 0)
  IF v_reward_amount > 0 THEN
      -- Update Score
      UPDATE public.minigame_scores 
      SET reward_amount = v_reward_amount 
      WHERE id = v_score_id;

      -- Update Wallet
      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_reward_amount, 'TOKEN', 'GAME_REWARD', 'Pit Stop Reward (' || p_score_ms || 'ms)');
      
      UPDATE public.wallets 
      SET token_balance = token_balance + v_reward_amount 
      WHERE id = v_wallet_id;

      -- Update Cooldown
      UPDATE public.profiles 
      SET last_minigame_reward_at = NOW() 
      WHERE id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
      'success', true, 
      'reward', v_reward_amount, 
      'score_ms', p_score_ms,
      'message', CASE 
          WHEN v_reward_amount > 0 THEN 'Pit Stop Complete! You earned ' || v_reward_amount || ' tokens!'
          ELSE 'Pit Stop Complete! Too slow for reward.'
      END,
      'on_cooldown', v_on_cooldown
  );
END;
$$;

-- 4. Update Distribution Function (New 1-9 distribution)
CREATE OR REPLACE FUNCTION public.distribute_monthly_minigame_rewards(
    p_game_type TEXT, -- Now requires game type
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pool_data JSONB;
    v_total_pool NUMERIC;
    v_leaderboard RECORD;
    v_reward NUMERIC;
    v_count INTEGER := 0;
    v_distributions NUMERIC[] := ARRAY[0.25, 0.18, 0.15, 0.12, 0.10, 0.08, 0.06, 0.04, 0.02];
    v_percent NUMERIC;
BEGIN
    -- 1. Calculate Pool
    v_pool_data := public.get_monthly_prize_pool(p_game_type, p_year, p_month);
    v_total_pool := (v_pool_data->>'dynamic_pool')::NUMERIC;
    
    -- 2. Iterate Top 9 (since we have 9 percentages)
    FOR v_leaderboard IN (
        SELECT * FROM public.get_monthly_leaderboard(p_game_type, p_year, p_month) LIMIT 9
    ) LOOP
        v_count := v_count + 1;
        
        -- Get Percentage
        v_percent := v_distributions[v_count];
        
        IF v_percent IS NOT NULL THEN
            v_reward := FLOOR(v_total_pool * v_percent);
            
            IF v_reward > 0 THEN
                -- Update Wallet
                UPDATE public.wallets 
                SET token_balance = token_balance + v_reward
                WHERE user_id = v_leaderboard.user_id;
                
                -- Add Ledger Entry
                INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
                VALUES (
                    (SELECT id FROM public.wallets WHERE user_id = v_leaderboard.user_id), 
                    v_reward, 
                    'TOKEN', 
                    'GAME_REWARD', 
                    'Monthly ' || p_game_type || ' Reward (Rank ' || v_leaderboard.rank || ')'
                );
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'distributed_count', v_count, 'total_pool', v_total_pool);
END;
$$;
