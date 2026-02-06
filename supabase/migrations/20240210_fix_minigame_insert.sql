-- Fix minigame_scores insert error (missing played_at column and constraints)
-- Re-implementing the logic to:
-- 1. Insert score first (with 0 reward) to ensure Rank calculation includes it.
-- 2. Use correct column names (created_at, game_type).
-- 3. Update reward if applicable.

CREATE OR REPLACE FUNCTION public.play_reaction_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_wallet_id UUID;
  v_pool_size INTEGER;
  v_last_reward_time TIMESTAMPTZ;
  v_reward_amount NUMERIC := 0;
  v_rank INTEGER;
  v_payout_ratio NUMERIC := 0;
  v_base_pool INTEGER := 500; -- Fixed Base Pool
  v_total_plays INTEGER;
  v_score_id UUID;
  v_cooldown_remaining INTEGER := 0;
  v_on_cooldown BOOLEAN := false;
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

  -- 3. Insert Score (Initial with 0 reward)
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

  -- 5. Calculate Pool (Base + 2 * Total Plays)
  SELECT COUNT(*) INTO v_total_plays FROM public.minigame_scores;
  v_pool_size := v_base_pool + (v_total_plays * 2);

  -- 6. Calculate Rank (Now includes the score we just inserted)
  WITH best_scores AS (
      SELECT user_id, MIN(score_ms) as best_score
      FROM public.minigame_scores
      GROUP BY user_id
  ),
  ranked_users AS (
      SELECT user_id, RANK() OVER (ORDER BY best_score ASC) as rank
      FROM best_scores
  )
  SELECT rank INTO v_rank FROM ranked_users WHERE user_id = v_user_id;

  -- 7. Determine Payout Ratio
  IF v_rank = 1 THEN v_payout_ratio := 0.30;
  ELSIF v_rank = 2 THEN v_payout_ratio := 0.20;
  ELSIF v_rank = 3 THEN v_payout_ratio := 0.10;
  ELSIF v_rank <= 10 THEN v_payout_ratio := 0.40 / 7.0; -- Split 40% among 4-10
  ELSE v_payout_ratio := 0;
  END IF;

  -- 8. Distribute Reward (If eligible and not on cooldown)
  IF v_payout_ratio > 0 AND NOT v_on_cooldown THEN
      v_reward_amount := FLOOR(v_pool_size * v_payout_ratio);
      
      IF v_reward_amount > 0 THEN
          -- Update Score with Reward Amount
          UPDATE public.minigame_scores 
          SET reward_amount = v_reward_amount 
          WHERE id = v_score_id;

          -- Update Wallet
          INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
          VALUES (v_wallet_id, v_reward_amount, 'TOKEN', 'GAME_REWARD', 'Minigame Rank ' || v_rank || ' Reward');
          
          UPDATE public.wallets 
          SET token_balance = token_balance + v_reward_amount 
          WHERE id = v_wallet_id;

          -- Update Profile Cooldown
          UPDATE public.profiles 
          SET last_minigame_reward_at = NOW() 
          WHERE id = v_user_id;

          RETURN jsonb_build_object(
              'success', true, 
              'message', 'New High Score! You won ' || v_reward_amount || ' tokens!', 
              'reward', v_reward_amount
          );
      END IF;
  END IF;

  -- Fallback / No Reward Case
  IF v_on_cooldown THEN
      RETURN jsonb_build_object(
          'success', true, 
          'message', 'Score updated! (Reward cooldown active)', 
          'reward', 0,
          'cooldown_remaining', v_cooldown_remaining
      );
  ELSE
      RETURN jsonb_build_object(
          'success', true, 
          'message', 'Score updated! Keep trying for Top 10.', 
          'reward', 0
      );
  END IF;
END;
$$;
