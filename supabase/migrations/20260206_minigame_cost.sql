-- Update play_reaction_game to charge 1 token per play
CREATE OR REPLACE FUNCTION public.play_reaction_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
  v_last_reward_time TIMESTAMPTZ;
  v_reward_amount NUMERIC;
  v_token_balance NUMERIC;
  v_cost CONSTANT INTEGER := 1;
  v_instant_reward CONSTANT INTEGER := 5;
  v_score_id UUID;
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

  -- 4. Deduct Cost
  UPDATE public.wallets 
  SET token_balance = token_balance - v_cost 
  WHERE id = v_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_wallet_id, -v_cost, 'TOKEN', 'GAME_COST', 'Minigame Entry Fee');

  -- 5. Record Score
  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount)
  VALUES (v_user_id, 'REACTION', p_score_ms, 0)
  RETURNING id INTO v_score_id;

  -- 6. Check Reward Cooldown (60 mins)
  SELECT last_minigame_reward_at INTO v_last_reward_time 
  FROM public.profiles 
  WHERE id = v_user_id;

  IF v_last_reward_time IS NOT NULL AND v_last_reward_time > NOW() - INTERVAL '60 minutes' THEN
    -- On cooldown, no reward.
    RETURN jsonb_build_object(
        'success', true, 
        'reward', 0,
        'message', 'Score recorded! (-1 Token)',
        'on_cooldown', true
    );
  END IF;

  -- 7. Award Reward (5 tokens) if not on cooldown
  v_reward_amount := v_instant_reward;

  UPDATE public.minigame_scores
  SET reward_amount = v_reward_amount
  WHERE id = v_score_id;

  UPDATE public.wallets 
  SET token_balance = token_balance + v_reward_amount 
  WHERE id = v_wallet_id;

  INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
  VALUES (v_wallet_id, v_reward_amount, 'TOKEN', 'GAME_REWARD', 'Minigame Reward: ' || p_score_ms || 'ms');

  UPDATE public.profiles 
  SET last_minigame_reward_at = NOW() 
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
      'success', true, 
      'reward', v_reward_amount, 
      'message', 'Reward claimed: ' || v_reward_amount || ' Tokens! (Net +4)',
      'on_cooldown', false
  );
END;
$$;
