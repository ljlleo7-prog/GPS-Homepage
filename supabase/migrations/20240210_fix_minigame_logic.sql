-- Fix Minigame Logic: Separate Single-Shot Reward from Monthly Rank Reward
-- 1. play_reaction_game: Awards fixed 5 tokens if not on cooldown (60m). Always records score.
-- 2. get_monthly_prize_pool: Calculates pool for display (Base 500 + 2 * plays).
-- 3. distribute_monthly_minigame_rewards: Distributes pool to top 10 at month end.

-- Function 1: Play Reaction Game (Instant Reward Logic)
CREATE OR REPLACE FUNCTION public.play_reaction_game(p_score_ms INTEGER)
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
  v_instant_reward_amount CONSTANT INTEGER := 5; -- Fixed 5 Tokens for participation/success
BEGIN
  -- 1. Get Wallet
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id;
  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Wallet not found');
  END IF;

  -- 2. ANTI-CHEAT: 110ms Jump Start
  IF p_score_ms < 110 THEN
     RETURN jsonb_build_object(
         'success', false, 
         'message', 'JUMP START! Reactions under 110ms are physically impossible.',
         'jump_start', true
     );
  END IF;

  -- 3. Insert Score (Always record for Ranking)
  -- Uses 'created_at' default NOW(), 'game_type' = 'REACTION'
  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount)
  VALUES (v_user_id, 'REACTION', p_score_ms, 0)
  RETURNING id INTO v_score_id;

  -- 4. Check Reward Cooldown (60 mins)
  SELECT last_minigame_reward_at INTO v_last_reward_time 
  FROM public.profiles 
  WHERE id = v_user_id;

  IF v_last_reward_time IS NOT NULL AND v_last_reward_time > NOW() - INTERVAL '60 minutes' THEN
    v_on_cooldown := true;
    v_cooldown_remaining := EXTRACT(EPOCH FROM (v_last_reward_time + INTERVAL '60 minutes' - NOW()))::INTEGER;
  END IF;

  -- 5. Award Instant Reward (If not on cooldown)
  IF NOT v_on_cooldown THEN
      v_reward_amount := v_instant_reward_amount;
      
      -- Update Score with Reward Amount (for tracking)
      UPDATE public.minigame_scores 
      SET reward_amount = v_reward_amount 
      WHERE id = v_score_id;

      -- Update Wallet
      INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
      VALUES (v_wallet_id, v_reward_amount, 'TOKEN', 'GAME_REWARD', 'Minigame Instant Reward (Score: ' || p_score_ms || 'ms)');
      
      UPDATE public.wallets 
      SET token_balance = token_balance + v_reward_amount 
      WHERE id = v_wallet_id;

      -- Update Profile Cooldown
      UPDATE public.profiles 
      SET last_minigame_reward_at = NOW() 
      WHERE id = v_user_id;
  END IF;

  -- 6. Return Result (Frontend handles "New Best Score" display via separate leaderboard fetch)
  RETURN jsonb_build_object(
      'success', true,
      'score_ms', p_score_ms,
      'reward', v_reward_amount,
      'cooldown_remaining', v_cooldown_remaining,
      'on_cooldown', v_on_cooldown,
      'message', CASE 
          WHEN v_reward_amount > 0 THEN 'Reward claimed: ' || v_reward_amount || ' Tokens!'
          ELSE 'Score recorded! Next reward available in ' || (v_cooldown_remaining / 60) || 'm.'
      END
  );
END;
$$;
