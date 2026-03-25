-- Migration: 20260224_complete_minigame_overhaul
-- Description: Consolidated migration for Minigame Statistics & Reward System.
-- Includes both Reaction and Pit Stop game updates.
-- Replaces previous partial migrations.

-- 1. Schema Updates
ALTER TABLE public.minigame_scores 
ADD COLUMN IF NOT EXISTS contributes_to_pool BOOLEAN DEFAULT false;

-- Backfill data (Reaction < 400ms, Pit Stop < 3500ms)
UPDATE public.minigame_scores 
SET contributes_to_pool = (score_ms < 400) 
WHERE game_type = 'REACTION' AND contributes_to_pool IS FALSE;

UPDATE public.minigame_scores 
SET contributes_to_pool = (score_ms < 3500) 
WHERE game_type = 'PIT_STOP' AND contributes_to_pool IS FALSE;

-- 2. Update Reaction Game Logic
CREATE OR REPLACE FUNCTION public.play_reaction_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
  v_token_balance NUMERIC;
  v_cost CONSTANT INTEGER := 1;
  v_refund_amount INTEGER := 0;
  v_profit_amount INTEGER := 0;
  v_total_reward INTEGER := 0;
  v_score_id UUID;
  
  -- Stats
  v_global_avg NUMERIC;
  v_global_stddev NUMERIC;
  v_user_avg NUMERIC;
  v_z_score NUMERIC;
  v_is_good_play BOOLEAN := false;
  v_is_improving BOOLEAN := false;
  
  -- Cooldown
  v_last_reward_time TIMESTAMPTZ;
  v_on_cooldown BOOLEAN := false;
  v_cooldown_remaining INTEGER := 0;
  
  v_message TEXT;
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

  -- 3. ANTI-CHEAT: 110ms Jump Start
  IF p_score_ms < 110 THEN
     RETURN jsonb_build_object(
         'success', false, 
         'message', 'JUMP START! Reactions under 110ms are physically impossible.',
         'jump_start', true
     );
  END IF;

  -- 4. Deduct Cost (Atomic)
  UPDATE public.wallets 
  SET token_balance = token_balance - v_cost 
  WHERE id = v_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_wallet_id, -v_cost, 'TOKEN', 'GAME_COST', 'Minigame Entry Fee');

  -- 5. Calculate Stats
  -- Global Stats (Last 7 Days)
  SELECT AVG(score_ms), STDDEV(score_ms)
  INTO v_global_avg, v_global_stddev
  FROM public.minigame_scores
  WHERE game_type = 'REACTION'
    AND created_at > NOW() - INTERVAL '7 days'
    AND score_ms BETWEEN 110 AND 1000; -- Filter outliers for stats
  
  -- Defaults if no data
  IF v_global_avg IS NULL THEN v_global_avg := 300; END IF;
  IF v_global_stddev IS NULL OR v_global_stddev = 0 THEN v_global_stddev := 50; END IF;

  -- User Stats (Last 20 Plays)
  SELECT AVG(score_ms)
  INTO v_user_avg
  FROM (
      SELECT score_ms FROM public.minigame_scores
      WHERE user_id = v_user_id
        AND game_type = 'REACTION'
      ORDER BY created_at DESC
      LIMIT 20
  ) sub;
  
  IF v_user_avg IS NULL THEN v_user_avg := 400; END IF; -- Default for new user

  -- 6. Evaluate Performance
  v_is_good_play := (p_score_ms < v_global_avg);
  v_is_improving := (p_score_ms < v_user_avg);

  -- Refund Logic: Free if Good or Improving
  IF v_is_good_play OR v_is_improving THEN
      v_refund_amount := v_cost;
  END IF;

  -- 7. Profit Logic (Hourly Cooldown)
  SELECT last_minigame_reward_at INTO v_last_reward_time 
  FROM public.profiles 
  WHERE id = v_user_id;

  IF v_last_reward_time IS NOT NULL AND v_last_reward_time > NOW() - INTERVAL '60 minutes' THEN
      v_on_cooldown := true;
      v_cooldown_remaining := EXTRACT(EPOCH FROM (v_last_reward_time + INTERVAL '60 minutes' - NOW()))::INTEGER;
  ELSE
      -- Calculate Profit based on Z-Score
      -- Z = (Avg - Score) / StdDev (Higher Z is better)
      v_z_score := (v_global_avg - p_score_ms) / v_global_stddev;
      
      IF v_z_score > 0 THEN
          -- Reward Formula: Floor(Z * 2)
          v_profit_amount := FLOOR(v_z_score * 2.0);
          -- Cap at 10
          IF v_profit_amount > 10 THEN v_profit_amount := 10; END IF;
      END IF;
  END IF;

  v_total_reward := v_refund_amount + v_profit_amount;

  -- 8. Record Score
  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount, contributes_to_pool)
  VALUES (v_user_id, 'REACTION', p_score_ms, v_total_reward, v_is_good_play)
  RETURNING id INTO v_score_id;

  -- 9. Award Reward
  IF v_total_reward > 0 THEN
      UPDATE public.wallets 
      SET token_balance = token_balance + v_total_reward 
      WHERE id = v_wallet_id;

      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_total_reward, 'TOKEN', 'GAME_REWARD', 
              'Minigame Reward (Refund: ' || v_refund_amount || ', Profit: ' || v_profit_amount || ')');
      
      -- Update Cooldown ONLY if Profit was awarded
      IF v_profit_amount > 0 THEN
          UPDATE public.profiles 
          SET last_minigame_reward_at = NOW() 
          WHERE id = v_user_id;
      END IF;
  END IF;

  -- 10. Construct Message
  IF v_total_reward > v_cost THEN
      v_message := 'Great job! Earned ' || (v_total_reward - v_cost) || ' profit tokens!';
  ELSIF v_total_reward = v_cost THEN
      v_message := 'Good practice! Entry fee refunded.';
  ELSE
      v_message := 'Keep practicing! Improve your score to earn refunds.';
  END IF;

  RETURN jsonb_build_object(
      'success', true, 
      'score_ms', p_score_ms,
      'reward', v_total_reward,
      'net_change', (v_total_reward - v_cost),
      'stats', jsonb_build_object(
          'global_avg', ROUND(v_global_avg, 1),
          'user_avg', ROUND(v_user_avg, 1),
          'z_score', ROUND(v_z_score, 2)
      ),
      'on_cooldown', v_on_cooldown,
      'cooldown_remaining', v_cooldown_remaining,
      'message', v_message
  );
END;
$$;

-- 3. Update Pit Stop Game Logic
CREATE OR REPLACE FUNCTION public.play_pit_stop_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
  v_token_balance NUMERIC;
  v_cost CONSTANT INTEGER := 1;
  v_refund_amount INTEGER := 0;
  v_profit_amount INTEGER := 0;
  v_total_reward INTEGER := 0;
  v_score_id UUID;
  
  -- Stats
  v_global_avg NUMERIC;
  v_global_stddev NUMERIC;
  v_user_avg NUMERIC;
  v_z_score NUMERIC;
  v_is_good_play BOOLEAN := false;
  v_is_improving BOOLEAN := false;
  
  -- Cooldown
  v_last_reward_time TIMESTAMPTZ;
  v_on_cooldown BOOLEAN := false;
  v_cooldown_remaining INTEGER := 0;
  
  v_message TEXT;
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

  -- 3. Deduct Cost (Atomic)
  UPDATE public.wallets 
  SET token_balance = token_balance - v_cost 
  WHERE id = v_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_wallet_id, -v_cost, 'TOKEN', 'GAME_COST', 'Pit Stop Challenge Entry Fee');

  -- 4. Calculate Stats (Pit Stop)
  -- Global Stats (Last 7 Days)
  SELECT AVG(score_ms), STDDEV(score_ms)
  INTO v_global_avg, v_global_stddev
  FROM public.minigame_scores
  WHERE game_type = 'PIT_STOP'
    AND created_at > NOW() - INTERVAL '7 days'
    AND score_ms BETWEEN 1000 AND 10000; -- Filter outliers (1s to 10s)
  
  -- Defaults if no data
  IF v_global_avg IS NULL THEN v_global_avg := 3000; END IF; -- 3.0s default
  IF v_global_stddev IS NULL OR v_global_stddev = 0 THEN v_global_stddev := 500; END IF; -- 0.5s default

  -- User Stats (Last 20 Plays)
  SELECT AVG(score_ms)
  INTO v_user_avg
  FROM (
      SELECT score_ms FROM public.minigame_scores
      WHERE user_id = v_user_id
        AND game_type = 'PIT_STOP'
      ORDER BY created_at DESC
      LIMIT 20
  ) sub;
  
  IF v_user_avg IS NULL THEN v_user_avg := 4000; END IF; -- Default for new user

  -- 5. Evaluate Performance (Lower is Better)
  v_is_good_play := (p_score_ms < v_global_avg);
  v_is_improving := (p_score_ms < v_user_avg);

  -- Refund Logic: Free if Good or Improving
  IF v_is_good_play OR v_is_improving THEN
      v_refund_amount := v_cost;
  END IF;

  -- 6. Profit Logic (Hourly Cooldown - Shared with Reaction)
  SELECT last_minigame_reward_at INTO v_last_reward_time 
  FROM public.profiles 
  WHERE id = v_user_id;

  IF v_last_reward_time IS NOT NULL AND v_last_reward_time > NOW() - INTERVAL '60 minutes' THEN
      v_on_cooldown := true;
      v_cooldown_remaining := EXTRACT(EPOCH FROM (v_last_reward_time + INTERVAL '60 minutes' - NOW()))::INTEGER;
  ELSE
      -- Calculate Profit based on Z-Score
      -- Z = (GlobalAvg - Score) / StdDev (Positive Z means faster than average)
      v_z_score := (v_global_avg - p_score_ms) / v_global_stddev;
      
      IF v_z_score > 0 THEN
          -- Reward Formula: Floor(Z * 2)
          v_profit_amount := FLOOR(v_z_score * 2.0);
          -- Cap at 10
          IF v_profit_amount > 10 THEN v_profit_amount := 10; END IF;
      END IF;
  END IF;

  v_total_reward := v_refund_amount + v_profit_amount;

  -- 7. Record Score
  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount, contributes_to_pool)
  VALUES (v_user_id, 'PIT_STOP', p_score_ms, v_total_reward, v_is_good_play)
  RETURNING id INTO v_score_id;

  -- 8. Award Reward
  IF v_total_reward > 0 THEN
      UPDATE public.wallets 
      SET token_balance = token_balance + v_total_reward 
      WHERE id = v_wallet_id;

      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_total_reward, 'TOKEN', 'GAME_REWARD', 
              'Pit Stop Reward (Refund: ' || v_refund_amount || ', Profit: ' || v_profit_amount || ')');
      
      -- Update Cooldown ONLY if Profit was awarded
      IF v_profit_amount > 0 THEN
          UPDATE public.profiles 
          SET last_minigame_reward_at = NOW() 
          WHERE id = v_user_id;
      END IF;
  END IF;

  -- 9. Construct Message
  IF v_total_reward > v_cost THEN
      v_message := 'Great job! Earned ' || (v_total_reward - v_cost) || ' profit tokens!';
  ELSIF v_total_reward = v_cost THEN
      v_message := 'Good practice! Entry fee refunded.';
  ELSE
      v_message := 'Keep practicing! Improve your score to earn refunds.';
  END IF;

  RETURN jsonb_build_object(
      'success', true, 
      'score_ms', p_score_ms,
      'reward', v_total_reward,
      'net_change', (v_total_reward - v_cost),
      'stats', jsonb_build_object(
          'global_avg', ROUND(v_global_avg, 1),
          'user_avg', ROUND(v_user_avg, 1),
          'z_score', ROUND(v_z_score, 2)
      ),
      'on_cooldown', v_on_cooldown,
      'cooldown_remaining', v_cooldown_remaining,
      'message', v_message
  );
END;
$$;

-- 4. Update Prize Pool (Generic)
DROP FUNCTION IF EXISTS public.get_monthly_prize_pool(integer, integer);
DROP FUNCTION IF EXISTS public.get_monthly_prize_pool(text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_monthly_prize_pool(
    p_game_type TEXT DEFAULT 'REACTION',
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
        AND game_type = p_game_type
        AND contributes_to_pool = true; -- Only good plays count
        
    v_total_pool := v_base_pool + (v_total_plays * v_token_per_play);
    
    RETURN jsonb_build_object(
        'total_plays', v_total_plays,
        'base_pool', v_base_pool,
        'dynamic_pool', v_total_pool,
        'game_type', p_game_type
    );
END;
$$;

-- 5. Update Monthly Reward Distribution (Strict)
CREATE OR REPLACE FUNCTION distribute_monthly_minigame_rewards(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_start_date TIMESTAMPTZ := make_timestamp(p_year, p_month, 1, 0, 0, 0);
    v_end_date TIMESTAMPTZ := v_start_date + INTERVAL '1 month';
    v_game_types TEXT[] := ARRAY['REACTION', 'PIT_STOP'];
    v_game_type TEXT;
    v_pool_data JSONB;
    v_total_pool INTEGER;
    v_leaderboard RECORD;
    v_reward INTEGER;
    v_processed_users JSONB := '[]'::JSONB;
    v_count INTEGER := 0;
BEGIN
    FOREACH v_game_type IN ARRAY v_game_types
    LOOP
        -- 1. Get Pool Size for this game
        v_pool_data := get_monthly_prize_pool(v_game_type, p_year, p_month);
        v_total_pool := (v_pool_data->>'dynamic_pool')::INTEGER;
        
        -- 2. Calculate Leaderboard (Top 10 by Avg)
        FOR v_leaderboard IN
            WITH UserScores AS (
                SELECT 
                    user_id, 
                    score_ms,
                    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score_ms ASC) as rn
                FROM public.minigame_scores
                WHERE created_at >= v_start_date AND created_at < v_end_date
                  AND game_type = v_game_type
            ),
            UserStats AS (
                SELECT 
                    user_id,
                    AVG(score_ms) as avg_best_10,
                    COUNT(*) as total_plays
                FROM UserScores
                WHERE rn <= 10 -- Take top 10 scores
                GROUP BY user_id
                HAVING COUNT(*) >= 10 -- Minimum 10 plays to qualify
            ),
            RankedUsers AS (
                SELECT 
                    user_id,
                    avg_best_10,
                    RANK() OVER (ORDER BY avg_best_10 ASC) as rank
                FROM UserStats
            )
            SELECT * FROM RankedUsers WHERE rank <= 10 ORDER BY rank ASC
        LOOP
            -- 3. Strict Reward Distribution
            -- 25%, 18%, 15%, 12%, 10%, 8%, 6%, 4%, 2%
            v_reward := 0;
            
            IF v_leaderboard.rank = 1 THEN v_reward := FLOOR(v_total_pool * 0.25);
            ELSIF v_leaderboard.rank = 2 THEN v_reward := FLOOR(v_total_pool * 0.18);
            ELSIF v_leaderboard.rank = 3 THEN v_reward := FLOOR(v_total_pool * 0.15);
            ELSIF v_leaderboard.rank = 4 THEN v_reward := FLOOR(v_total_pool * 0.12);
            ELSIF v_leaderboard.rank = 5 THEN v_reward := FLOOR(v_total_pool * 0.10);
            ELSIF v_leaderboard.rank = 6 THEN v_reward := FLOOR(v_total_pool * 0.08);
            ELSIF v_leaderboard.rank = 7 THEN v_reward := FLOOR(v_total_pool * 0.06);
            ELSIF v_leaderboard.rank = 8 THEN v_reward := FLOOR(v_total_pool * 0.04);
            ELSIF v_leaderboard.rank = 9 THEN v_reward := FLOOR(v_total_pool * 0.02);
            -- Rank 10 gets 0% (Remainder)
            END IF;

            -- 4. Distribute
            IF v_reward > 0 THEN
                UPDATE public.wallets 
                SET token_balance = token_balance + v_reward 
                WHERE user_id = v_leaderboard.user_id;
                
                INSERT INTO public.ledger_entries (
                    wallet_id, amount, currency, operation_type, description
                )
                SELECT 
                    id, v_reward, 'TOKEN', 'REWARD', 
                    v_game_type || ' Monthly Reward: Rank #' || v_leaderboard.rank || ' (Avg: ' || ROUND(v_leaderboard.avg_best_10, 1) || 'ms)'
                FROM public.wallets 
                WHERE user_id = v_leaderboard.user_id;
                
                v_processed_users := v_processed_users || jsonb_build_object(
                    'user_id', v_leaderboard.user_id,
                    'game_type', v_game_type,
                    'rank', v_leaderboard.rank,
                    'reward', v_reward,
                    'avg_score', v_leaderboard.avg_best_10
                );
                v_count := v_count + 1;
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true, 
        'recipients_count', v_count,
        'details', v_processed_users
    );
END;
$$;

-- 6. Update Leaderboard Function (Generic)
DROP FUNCTION IF EXISTS public.get_monthly_leaderboard(integer, integer);

CREATE OR REPLACE FUNCTION get_monthly_leaderboard(
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER,
    p_game_type TEXT DEFAULT 'REACTION'
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
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH UserScores AS (
        SELECT 
            ms.user_id,
            ms.score_ms,
            ms.created_at,
            ROW_NUMBER() OVER (PARTITION BY ms.user_id ORDER BY ms.score_ms ASC) as rn,
            COUNT(*) OVER (PARTITION BY ms.user_id) as total_count
        FROM public.minigame_scores ms
        WHERE 
            EXTRACT(YEAR FROM ms.created_at) = p_year
            AND EXTRACT(MONTH FROM ms.created_at) = p_month
            AND ms.game_type = p_game_type
    ),
    UserStats AS (
        SELECT 
            us.user_id,
            AVG(us.score_ms) as avg_score,
            MAX(us.total_count) as total_plays,
            MAX(us.created_at) as last_played
        FROM UserScores us
        WHERE us.rn <= 10
        GROUP BY us.user_id
        HAVING MAX(us.total_count) >= 10 -- Only users with 10+ scores
    )
    SELECT 
        us.user_id,
        COALESCE(p.username, 'Anonymous') as username,
        ROUND(us.avg_score)::INTEGER as best_score,
        RANK() OVER (ORDER BY us.avg_score ASC) as rank,
        us.total_plays,
        us.last_played
    FROM UserStats us
    LEFT JOIN public.profiles p ON us.user_id = p.id
    ORDER BY us.avg_score ASC
    LIMIT 100;
END;
$$;
