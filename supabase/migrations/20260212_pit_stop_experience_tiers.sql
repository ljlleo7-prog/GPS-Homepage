CREATE OR REPLACE FUNCTION public.play_pit_stop_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
  v_reward_amount INTEGER := 0;
  v_score_id UUID;
  v_cost CONSTANT INTEGER := 1;
  v_token_balance NUMERIC;
  v_month_start TIMESTAMPTZ := date_trunc('month', NOW());
  v_plays_this_month INTEGER := 0;
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

  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount)
  VALUES (v_user_id, 'PIT_STOP', p_score_ms, 0)
  RETURNING id INTO v_score_id;

  SELECT COUNT(*) INTO v_plays_this_month
  FROM public.minigame_scores
  WHERE user_id = v_user_id
    AND game_type = 'PIT_STOP'
    AND created_at >= v_month_start;

  IF v_plays_this_month <= 10 THEN
      IF p_score_ms < 2000 THEN v_reward_amount := 50;
      ELSIF p_score_ms < 2500 THEN v_reward_amount := 20;
      ELSIF p_score_ms < 3000 THEN v_reward_amount := 10;
      ELSIF p_score_ms < 4000 THEN v_reward_amount := 5;
      ELSIF p_score_ms < 5000 THEN v_reward_amount := 2;
      ELSIF p_score_ms < 8000 THEN v_reward_amount := 1;
      ELSE v_reward_amount := 0;
      END IF;
  ELSIF v_plays_this_month <= 30 THEN
      IF p_score_ms < 2000 THEN v_reward_amount := 20;
      ELSIF p_score_ms < 2500 THEN v_reward_amount := 10;
      ELSIF p_score_ms < 3000 THEN v_reward_amount := 5;
      ELSIF p_score_ms < 4000 THEN v_reward_amount := 2;
      ELSIF p_score_ms < 6000 THEN v_reward_amount := 1;
      ELSE v_reward_amount := 0;
      END IF;
  ELSIF v_plays_this_month <= 50 THEN
      IF p_score_ms < 2000 THEN v_reward_amount := 10;
      ELSIF p_score_ms < 2500 THEN v_reward_amount := 5;
      ELSIF p_score_ms < 3000 THEN v_reward_amount := 3;
      ELSIF p_score_ms < 4000 THEN v_reward_amount := 2;
      ELSIF p_score_ms < 5000 THEN v_reward_amount := 1;
      ELSE v_reward_amount := 0;
      END IF;
  ELSIF v_plays_this_month <= 100 THEN
      IF p_score_ms < 2000 THEN v_reward_amount := 10;
      ELSIF p_score_ms < 2500 THEN v_reward_amount := 5;
      ELSIF p_score_ms < 3000 THEN v_reward_amount := 2;
      ELSIF p_score_ms < 5000 THEN v_reward_amount := 1;
      ELSE v_reward_amount := 0;
      END IF;
  ELSIF v_plays_this_month <= 200 THEN
      IF p_score_ms < 2000 THEN v_reward_amount := 5;
      ELSIF p_score_ms < 2500 THEN v_reward_amount := 3;
      ELSIF p_score_ms < 3000 THEN v_reward_amount := 2;
      ELSIF p_score_ms < 4000 THEN v_reward_amount := 1;
      ELSE v_reward_amount := 0;
      END IF;
  ELSE
      IF p_score_ms < 2000 THEN v_reward_amount := 5;
      ELSIF p_score_ms < 2500 THEN v_reward_amount := 2;
      ELSIF p_score_ms < 3000 THEN v_reward_amount := 1;
      ELSE v_reward_amount := 0;
      END IF;
  END IF;

  IF v_reward_amount > 0 THEN
      UPDATE public.minigame_scores 
      SET reward_amount = v_reward_amount 
      WHERE id = v_score_id;

      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_reward_amount, 'TOKEN', 'GAME_REWARD', 'Pit Stop Reward (' || p_score_ms || 'ms, ' || v_plays_this_month || ' plays this month)');
      
      UPDATE public.wallets 
      SET token_balance = token_balance + v_reward_amount 
      WHERE id = v_wallet_id;
  END IF;

  RETURN jsonb_build_object(
      'success', true, 
      'reward', v_reward_amount, 
      'score_ms', p_score_ms,
      'message', CASE 
          WHEN v_reward_amount > 0 THEN 'Pit Stop Complete! You earned ' || v_reward_amount || ' tokens!'
          ELSE 'Pit Stop Complete! Too slow for reward.'
      END,
      'on_cooldown', false
  );
END;
$$;
