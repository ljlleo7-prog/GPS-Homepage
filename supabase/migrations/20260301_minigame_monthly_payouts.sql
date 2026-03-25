DO $$
DECLARE
  v_pk TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'minigame_reward_runs'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'minigame_reward_runs'
        AND column_name = 'game_type'
    ) THEN
      ALTER TABLE public.minigame_reward_runs ADD COLUMN game_type TEXT DEFAULT 'REACTION';
      UPDATE public.minigame_reward_runs SET game_type = 'REACTION' WHERE game_type IS NULL;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'minigame_reward_runs'
        AND column_name = 'pool_size'
    ) THEN
      ALTER TABLE public.minigame_reward_runs ADD COLUMN pool_size INTEGER;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'minigame_reward_runs'
        AND column_name = 'status'
    ) THEN
      ALTER TABLE public.minigame_reward_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'minigame_reward_runs'
        AND column_name = 'error_message'
    ) THEN
      ALTER TABLE public.minigame_reward_runs ADD COLUMN error_message TEXT;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'minigame_reward_runs'
        AND column_name = 'updated_at'
    ) THEN
      ALTER TABLE public.minigame_reward_runs ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;

    SELECT tc.constraint_name INTO v_pk
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'minigame_reward_runs'
      AND tc.constraint_type = 'PRIMARY KEY'
    LIMIT 1;

    IF v_pk IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.minigame_reward_runs DROP CONSTRAINT %I', v_pk);
    END IF;

    ALTER TABLE public.minigame_reward_runs
      ADD CONSTRAINT minigame_reward_runs_pkey PRIMARY KEY (year, month, game_type);
  ELSE
    CREATE TABLE public.minigame_reward_runs (
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      game_type TEXT NOT NULL,
      pool_size INTEGER,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (year, month, game_type)
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_minigame_reward_pool(
  p_year INTEGER,
  p_month INTEGER,
  p_game_type TEXT,
  p_pool_size INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.minigame_reward_runs (year, month, game_type, pool_size, status)
  VALUES (p_year, p_month, p_game_type, p_pool_size, 'PENDING')
  ON CONFLICT (year, month, game_type)
  DO UPDATE SET pool_size = EXCLUDED.pool_size, status = 'PENDING', updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'year', p_year,
    'month', p_month,
    'game_type', p_game_type,
    'pool_size', p_pool_size
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.distribute_previous_month_minigame_rewards()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_date DATE := (date_trunc('month', NOW()) - interval '1 day')::DATE;
  v_year INTEGER := EXTRACT(YEAR FROM v_target_date)::INTEGER;
  v_month INTEGER := EXTRACT(MONTH FROM v_target_date)::INTEGER;
  v_game_types TEXT[] := ARRAY['REACTION', 'PIT_STOP'];
  v_game_type TEXT;
  v_pool_data JSONB;
  v_pool_size INTEGER;
  v_already_paid BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.minigame_reward_runs
    WHERE year = v_year AND month = v_month AND status = 'PAID'
  ) INTO v_already_paid;

  IF v_already_paid THEN
    RETURN jsonb_build_object('success', false, 'message', 'already_processed', 'year', v_year, 'month', v_month);
  END IF;

  FOREACH v_game_type IN ARRAY v_game_types
  LOOP
    v_pool_data := get_monthly_prize_pool(v_game_type, v_year, v_month);
    v_pool_size := COALESCE((v_pool_data->>'dynamic_pool')::INTEGER, 0);

    INSERT INTO public.minigame_reward_runs (year, month, game_type, pool_size, status)
    VALUES (v_year, v_month, v_game_type, v_pool_size, 'PENDING')
    ON CONFLICT (year, month, game_type)
    DO UPDATE SET pool_size = EXCLUDED.pool_size, status = 'PENDING', updated_at = NOW();
  END LOOP;

  v_result := distribute_monthly_minigame_rewards(v_year, v_month);

  RETURN jsonb_build_object(
    'success', true,
    'year', v_year,
    'month', v_month,
    'result', v_result
  );
END;
$$;

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
  v_year INTEGER := p_year;
  v_month INTEGER := p_month;
  v_total_plays INTEGER;
  v_base_pool INTEGER := 500;
  v_token_per_play INTEGER := 2;
  v_total_pool INTEGER;
  v_pool_snapshot INTEGER;
  v_status TEXT;
  v_has_rows BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.minigame_scores ms
    WHERE EXTRACT(YEAR FROM ms.created_at) = p_year
      AND EXTRACT(MONTH FROM ms.created_at) = p_month
      AND ms.game_type = p_game_type
  ) INTO v_has_rows;

  IF NOT v_has_rows
     AND p_year = EXTRACT(YEAR FROM NOW())::INTEGER
     AND p_month = EXTRACT(MONTH FROM NOW())::INTEGER
     AND EXTRACT(DAY FROM NOW())::INTEGER = 1 THEN
    v_year := EXTRACT(YEAR FROM (date_trunc('month', NOW()) - interval '1 day'))::INTEGER;
    v_month := EXTRACT(MONTH FROM (date_trunc('month', NOW()) - interval '1 day'))::INTEGER;
  END IF;

  SELECT pool_size, status
  INTO v_pool_snapshot, v_status
  FROM public.minigame_reward_runs
  WHERE year = v_year AND month = v_month AND game_type = p_game_type
  LIMIT 1;

  SELECT COUNT(*) INTO v_total_plays
  FROM public.minigame_scores
  WHERE 
    EXTRACT(YEAR FROM created_at) = v_year
    AND EXTRACT(MONTH FROM created_at) = v_month
    AND game_type = p_game_type
    AND contributes_to_pool = true;

  IF v_pool_snapshot IS NOT NULL THEN
    v_total_pool := v_pool_snapshot;
  ELSE
    v_total_pool := v_base_pool + (v_total_plays * v_token_per_play);
  END IF;

  RETURN jsonb_build_object(
    'total_plays', COALESCE(v_total_plays, 0),
    'base_pool', v_base_pool,
    'dynamic_pool', v_total_pool,
    'game_type', p_game_type,
    'payout_status', COALESCE(v_status, 'UNPROCESSED'),
    'payout_year', v_year,
    'payout_month', v_month
  );
END;
$$;

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
  v_pool_snapshot INTEGER;
  v_total_pool INTEGER;
  v_leaderboard RECORD;
  v_reward INTEGER;
  v_processed_users JSONB := '[]'::JSONB;
  v_count INTEGER := 0;
BEGIN
  FOREACH v_game_type IN ARRAY v_game_types
  LOOP
    SELECT pool_size
    INTO v_pool_snapshot
    FROM public.minigame_reward_runs
    WHERE year = p_year AND month = p_month AND game_type = v_game_type
    LIMIT 1;

    IF v_pool_snapshot IS NULL THEN
      v_pool_data := get_monthly_prize_pool(v_game_type, p_year, p_month);
      v_total_pool := (v_pool_data->>'dynamic_pool')::INTEGER;
      INSERT INTO public.minigame_reward_runs (year, month, game_type, pool_size, status)
      VALUES (p_year, p_month, v_game_type, v_total_pool, 'PENDING')
      ON CONFLICT (year, month, game_type)
      DO UPDATE SET pool_size = EXCLUDED.pool_size, status = 'PENDING', updated_at = NOW();
    ELSE
      v_total_pool := v_pool_snapshot;
    END IF;

    FOR v_leaderboard IN
      WITH UserStats AS (
        SELECT 
          user_id,
          MIN(score_ms) as best_score,
          COUNT(*) as total_plays
        FROM public.minigame_scores
        WHERE created_at >= v_start_date AND created_at < v_end_date
          AND game_type = v_game_type
        GROUP BY user_id
      ),
      RankedUsers AS (
        SELECT 
          user_id,
          best_score,
          RANK() OVER (ORDER BY best_score ASC) as rank
        FROM UserStats
      )
      SELECT * FROM RankedUsers WHERE rank <= 10 ORDER BY rank ASC
    LOOP
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
      END IF;

      IF v_reward > 0 THEN
        UPDATE public.wallets 
        SET token_balance = token_balance + v_reward 
        WHERE user_id = v_leaderboard.user_id;

        INSERT INTO public.ledger_entries (
          wallet_id, amount, currency, operation_type, description
        )
        SELECT 
          id, v_reward, 'TOKEN', 'REWARD', 
          v_game_type || ' Monthly Reward: Rank #' || v_leaderboard.rank || ' (Score: ' || v_leaderboard.best_score || 'ms)'
        FROM public.wallets 
        WHERE user_id = v_leaderboard.user_id;

        v_processed_users := v_processed_users || jsonb_build_object(
          'user_id', v_leaderboard.user_id,
          'game_type', v_game_type,
          'rank', v_leaderboard.rank,
          'reward', v_reward,
          'best_score', v_leaderboard.best_score
        );
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.minigame_reward_runs
  SET status = 'PAID', error_message = NULL, updated_at = NOW()
  WHERE year = p_year AND month = p_month;

  RETURN jsonb_build_object(
    'success', true, 
    'recipients_count', v_count,
    'details', v_processed_users
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.minigame_reward_runs
  SET status = 'FAILED', error_message = SQLERRM, updated_at = NOW()
  WHERE year = p_year AND month = p_month;

  RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_leaderboard(
  p_game_type TEXT DEFAULT 'REACTION',
  p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
  p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  avatar_url TEXT,
  best_score INTEGER,
  rank BIGINT,
  total_plays BIGINT,
  last_played_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_year INTEGER := p_year;
  v_month INTEGER := p_month;
  v_has_rows BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.minigame_scores ms
    WHERE EXTRACT(YEAR FROM ms.created_at) = p_year
      AND EXTRACT(MONTH FROM ms.created_at) = p_month
      AND ms.game_type = p_game_type
  ) INTO v_has_rows;

  IF NOT v_has_rows
     AND p_year = EXTRACT(YEAR FROM NOW())::INTEGER
     AND p_month = EXTRACT(MONTH FROM NOW())::INTEGER
     AND EXTRACT(DAY FROM NOW())::INTEGER = 1 THEN
    v_year := EXTRACT(YEAR FROM (date_trunc('month', NOW()) - interval '1 day'))::INTEGER;
    v_month := EXTRACT(MONTH FROM (date_trunc('month', NOW()) - interval '1 day'))::INTEGER;
  END IF;

  RETURN QUERY
  WITH UserScores AS (
    SELECT 
      ms.user_id,
      MIN(ms.score_ms) as min_score,
      COUNT(*) as total_count,
      MAX(ms.created_at) as last_played
    FROM public.minigame_scores ms
    WHERE 
      EXTRACT(YEAR FROM ms.created_at) = v_year
      AND EXTRACT(MONTH FROM ms.created_at) = v_month
      AND ms.game_type = p_game_type
    GROUP BY ms.user_id
  )
  SELECT 
    us.user_id,
    COALESCE(p.username, 'Anonymous') as username,
    p.avatar_url,
    us.min_score as best_score,
    RANK() OVER (ORDER BY us.min_score ASC) as rank,
    us.total_count as total_plays,
    us.last_played as last_played_at
  FROM UserScores us
  LEFT JOIN public.profiles p ON us.user_id = p.id
  ORDER BY us.min_score ASC
  LIMIT 100;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
DECLARE
  v_jobid INTEGER;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'monthly_minigame_rewards' LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END;
$$;
SELECT cron.schedule(
  'monthly_minigame_rewards',
  '5 0 1 * *',
  $$ SELECT public.distribute_previous_month_minigame_rewards(); $$
);
