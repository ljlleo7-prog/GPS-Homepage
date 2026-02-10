-- Fix Pit Stop Reward Logic
-- 1. Remove Cooldown Check (Unlimited plays/rewards for Pit Stop)
-- 2. Adjust Reward Tiers as requested:
--    < 2.0s   -> 20 Tokens
--    2.0-2.5s -> 10 Tokens
--    2.5-3.0s -> 5 Tokens
--    3.0-4.0s -> 2 Tokens
--    4.0-6.0s -> 1 Token
--    > 6.0s   -> 0 Tokens

CREATE OR REPLACE FUNCTION public.play_pit_stop_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
  v_reward_amount NUMERIC := 0;
  v_score_id UUID;
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

  -- 5. Calculate Reward (Tiered)
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

  -- 6. Award Reward (If reward > 0)
  -- Note: We DO NOT check for cooldown here, nor do we update the global cooldown.
  -- Pit Stop is now independent of the daily/hourly limit to encourage practice.
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
