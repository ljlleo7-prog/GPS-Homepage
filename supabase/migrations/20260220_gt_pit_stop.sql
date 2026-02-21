CREATE OR REPLACE FUNCTION public.play_gt_pit_stop_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
  v_reward_amount NUMERIC := 0;
  v_score_id UUID;
  v_cost CONSTANT INTEGER := 1;
  v_token_balance NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;
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
  VALUES (v_wallet_id, -v_cost, 'TOKEN', 'GAME_COST', 'GT Pit Stop Challenge Entry Fee');

  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount)
  VALUES (v_user_id, 'PIT_STOP_GT', p_score_ms, 0)
  RETURNING id INTO v_score_id;

  IF p_score_ms < 20000 THEN
      v_reward_amount := 20;
  ELSIF p_score_ms < 25000 THEN
      v_reward_amount := 10;
  ELSIF p_score_ms < 30000 THEN
      v_reward_amount := 5;
  ELSIF p_score_ms < 40000 THEN
      v_reward_amount := 2;
  ELSIF p_score_ms < 60000 THEN
      v_reward_amount := 1;
  ELSE
      v_reward_amount := 0;
  END IF;

  IF v_reward_amount > 0 THEN
      UPDATE public.minigame_scores 
      SET reward_amount = v_reward_amount 
      WHERE id = v_score_id;

      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_reward_amount, 'TOKEN', 'GAME_REWARD', 'GT Pit Stop Reward (' || p_score_ms || 'ms)');
      
      UPDATE public.wallets 
      SET token_balance = token_balance + v_reward_amount 
      WHERE id = v_wallet_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reward', v_reward_amount,
    'message', 'Score recorded'
  );
END;
$$;
