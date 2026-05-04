-- Allow up to 3 profitable minigame rewards before the 60-minute cooldown starts.
-- Refund-only plays still do not consume reward slots.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS minigame_reward_streak_count INTEGER DEFAULT 0 NOT NULL;

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
  v_reward_limit CONSTANT INTEGER := 3;
  v_refund_amount INTEGER := 0;
  v_profit_amount INTEGER := 0;
  v_total_reward INTEGER := 0;
  v_score_id UUID;
  v_global_avg NUMERIC;
  v_global_stddev NUMERIC;
  v_user_avg NUMERIC;
  v_z_score NUMERIC;
  v_is_good_play BOOLEAN := false;
  v_is_improving BOOLEAN := false;
  v_last_reward_time TIMESTAMPTZ;
  v_reward_streak_count INTEGER := 0;
  v_on_cooldown BOOLEAN := false;
  v_cooldown_remaining INTEGER := 0;
  v_message TEXT;
BEGIN
  SELECT id, token_balance INTO v_wallet_id, v_token_balance
  FROM public.wallets
  WHERE user_id = v_user_id;

  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Wallet not found');
  END IF;

  IF v_token_balance < v_cost THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient tokens. Need 1 token to play.');
  END IF;

  IF p_score_ms < 110 THEN
     RETURN jsonb_build_object(
         'success', false,
         'message', 'JUMP START! Reactions under 110ms are physically impossible.',
         'jump_start', true
     );
  END IF;

  UPDATE public.wallets
  SET token_balance = token_balance - v_cost
  WHERE id = v_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_wallet_id, -v_cost, 'TOKEN', 'GAME_COST', 'Minigame Entry Fee');

  SELECT AVG(score_ms), STDDEV(score_ms)
  INTO v_global_avg, v_global_stddev
  FROM public.minigame_scores
  WHERE game_type = 'REACTION'
    AND created_at > NOW() - INTERVAL '7 days'
    AND score_ms BETWEEN 110 AND 1000;

  IF v_global_avg IS NULL THEN v_global_avg := 300; END IF;
  IF v_global_stddev IS NULL OR v_global_stddev = 0 THEN v_global_stddev := 50; END IF;

  SELECT AVG(score_ms)
  INTO v_user_avg
  FROM (
      SELECT score_ms FROM public.minigame_scores
      WHERE user_id = v_user_id
        AND game_type = 'REACTION'
      ORDER BY created_at DESC
      LIMIT 20
  ) sub;

  IF v_user_avg IS NULL THEN v_user_avg := 400; END IF;

  v_is_good_play := (p_score_ms < v_global_avg);
  v_is_improving := (p_score_ms < v_user_avg);

  IF v_is_good_play OR v_is_improving THEN
      v_refund_amount := v_cost;
  END IF;

  SELECT last_minigame_reward_at, COALESCE(minigame_reward_streak_count, 0)
  INTO v_last_reward_time, v_reward_streak_count
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_last_reward_time IS NULL OR v_last_reward_time <= NOW() - INTERVAL '60 minutes' THEN
      v_reward_streak_count := 0;
  ELSIF v_reward_streak_count >= v_reward_limit THEN
      v_on_cooldown := true;
      v_cooldown_remaining := EXTRACT(EPOCH FROM (v_last_reward_time + INTERVAL '60 minutes' - NOW()))::INTEGER;
  END IF;

  IF NOT v_on_cooldown THEN
      v_z_score := (v_global_avg - p_score_ms) / v_global_stddev;

      IF v_z_score > 0 THEN
          v_profit_amount := FLOOR(v_z_score * 4.0);
          IF v_profit_amount > 20 THEN v_profit_amount := 20; END IF;
      END IF;
  END IF;

  v_total_reward := v_refund_amount + v_profit_amount;

  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount, contributes_to_pool)
  VALUES (v_user_id, 'REACTION', p_score_ms, v_total_reward, v_is_good_play)
  RETURNING id INTO v_score_id;

  IF v_total_reward > 0 THEN
      UPDATE public.wallets
      SET token_balance = token_balance + v_total_reward
      WHERE id = v_wallet_id;

      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_total_reward, 'TOKEN', 'GAME_REWARD',
              'Minigame Reward (Refund: ' || v_refund_amount || ', Profit: ' || v_profit_amount || ')');

      IF v_profit_amount > 0 THEN
          UPDATE public.profiles
          SET last_minigame_reward_at = NOW(),
              minigame_reward_streak_count = v_reward_streak_count + 1
          WHERE id = v_user_id;
      END IF;
  END IF;

  IF v_total_reward > v_cost THEN
      v_message := 'Great job! Earned ' || (v_total_reward - v_cost) || ' profit tokens! Reward attempt ' || LEAST(v_reward_streak_count + 1, v_reward_limit) || '/' || v_reward_limit || '.';
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
      'reward_attempts_used', CASE WHEN v_profit_amount > 0 THEN LEAST(v_reward_streak_count + 1, v_reward_limit) ELSE v_reward_streak_count END,
      'reward_attempts_limit', v_reward_limit,
      'message', v_message
  );
END;
$$;

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
  v_reward_limit CONSTANT INTEGER := 3;
  v_refund_amount INTEGER := 0;
  v_profit_amount INTEGER := 0;
  v_total_reward INTEGER := 0;
  v_score_id UUID;
  v_global_avg NUMERIC;
  v_global_stddev NUMERIC;
  v_user_avg NUMERIC;
  v_z_score NUMERIC;
  v_is_good_play BOOLEAN := false;
  v_is_improving BOOLEAN := false;
  v_last_reward_time TIMESTAMPTZ;
  v_reward_streak_count INTEGER := 0;
  v_on_cooldown BOOLEAN := false;
  v_cooldown_remaining INTEGER := 0;
  v_message TEXT;
BEGIN
  SELECT id, token_balance INTO v_wallet_id, v_token_balance
  FROM public.wallets
  WHERE user_id = v_user_id;

  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Wallet not found');
  END IF;

  IF v_token_balance < v_cost THEN
    RETURN jsonb_build_object('success', false, 'message', 'Insufficient tokens. Need 1 token to play.');
  END IF;

  UPDATE public.wallets
  SET token_balance = token_balance - v_cost
  WHERE id = v_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_wallet_id, -v_cost, 'TOKEN', 'GAME_COST', 'Pit Stop Challenge Entry Fee');

  SELECT AVG(score_ms), STDDEV(score_ms)
  INTO v_global_avg, v_global_stddev
  FROM public.minigame_scores
  WHERE game_type = 'PIT_STOP'
    AND created_at > NOW() - INTERVAL '7 days'
    AND score_ms BETWEEN 1000 AND 10000;

  IF v_global_avg IS NULL THEN v_global_avg := 3000; END IF;
  IF v_global_stddev IS NULL OR v_global_stddev = 0 THEN v_global_stddev := 500; END IF;

  SELECT AVG(score_ms)
  INTO v_user_avg
  FROM (
      SELECT score_ms FROM public.minigame_scores
      WHERE user_id = v_user_id
        AND game_type = 'PIT_STOP'
      ORDER BY created_at DESC
      LIMIT 20
  ) sub;

  IF v_user_avg IS NULL THEN v_user_avg := 4000; END IF;

  v_is_good_play := (p_score_ms < v_global_avg);
  v_is_improving := (p_score_ms < v_user_avg);

  IF v_is_good_play OR v_is_improving THEN
      v_refund_amount := v_cost;
  END IF;

  SELECT last_minigame_reward_at, COALESCE(minigame_reward_streak_count, 0)
  INTO v_last_reward_time, v_reward_streak_count
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_last_reward_time IS NULL OR v_last_reward_time <= NOW() - INTERVAL '60 minutes' THEN
      v_reward_streak_count := 0;
  ELSIF v_reward_streak_count >= v_reward_limit THEN
      v_on_cooldown := true;
      v_cooldown_remaining := EXTRACT(EPOCH FROM (v_last_reward_time + INTERVAL '60 minutes' - NOW()))::INTEGER;
  END IF;

  IF NOT v_on_cooldown THEN
      v_z_score := (v_global_avg - p_score_ms) / v_global_stddev;

      IF v_z_score > 0 THEN
          v_profit_amount := FLOOR(v_z_score * 4.0);
          IF v_profit_amount > 20 THEN v_profit_amount := 20; END IF;
      END IF;
  END IF;

  v_total_reward := v_refund_amount + v_profit_amount;

  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount, contributes_to_pool)
  VALUES (v_user_id, 'PIT_STOP', p_score_ms, v_total_reward, v_is_good_play)
  RETURNING id INTO v_score_id;

  IF v_total_reward > 0 THEN
      UPDATE public.wallets
      SET token_balance = token_balance + v_total_reward
      WHERE id = v_wallet_id;

      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_total_reward, 'TOKEN', 'GAME_REWARD',
              'Pit Stop Reward (Refund: ' || v_refund_amount || ', Profit: ' || v_profit_amount || ')');

      IF v_profit_amount > 0 THEN
          UPDATE public.profiles
          SET last_minigame_reward_at = NOW(),
              minigame_reward_streak_count = v_reward_streak_count + 1
          WHERE id = v_user_id;
      END IF;
  END IF;

  IF v_total_reward > v_cost THEN
      v_message := 'Great job! Earned ' || (v_total_reward - v_cost) || ' profit tokens! Reward attempt ' || LEAST(v_reward_streak_count + 1, v_reward_limit) || '/' || v_reward_limit || '.';
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
      'reward_attempts_used', CASE WHEN v_profit_amount > 0 THEN LEAST(v_reward_streak_count + 1, v_reward_limit) ELSE v_reward_streak_count END,
      'reward_attempts_limit', v_reward_limit,
      'message', v_message
  );
END;
$$;
