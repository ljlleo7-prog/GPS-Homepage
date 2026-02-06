-- Update Minigame Anti-Cheat to strictly block < 110ms (to prevent 100ms spam exploits)
-- Also keeps the reward logic intact

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
  v_reward_amount NUMERIC;
  v_rank INTEGER;
  v_payout_ratio NUMERIC;
  v_base_pool INTEGER := 500; -- Fixed Base Pool
  v_total_plays INTEGER;
BEGIN
  -- 1. Get Wallet
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id;
  IF v_wallet_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Wallet not found');
  END IF;

  -- 2. ANTI-CHEAT: 110ms Jump Start (Stricter than 100ms to catch spam)
  IF p_score_ms < 110 THEN
     RETURN jsonb_build_object(
         'success', false, 
         'message', 'JUMP START! Reactions under 110ms are physically impossible.',
         'jump_start', true
     );
  END IF;

  -- 3. Record Score (Always allow score updates)
  INSERT INTO public.minigame_scores (user_id, score_ms, played_at)
  VALUES (v_user_id, p_score_ms, NOW());

  -- 4. Check Reward Cooldown (60 mins)
  SELECT last_minigame_reward_at INTO v_last_reward_time 
  FROM public.profiles 
  WHERE id = v_user_id;

  IF v_last_reward_time IS NOT NULL AND v_last_reward_time > NOW() - INTERVAL '60 minutes' THEN
    -- Score recorded, but no reward
    RETURN jsonb_build_object(
        'success', true, 
        'message', 'Score updated! (Reward cooldown active)', 
        'reward', 0,
        'cooldown_remaining', EXTRACT(EPOCH FROM (v_last_reward_time + INTERVAL '60 minutes' - NOW()))::INTEGER
    );
  END IF;

  -- 5. Calculate Pool (Base + 2 * Total Plays)
  SELECT COUNT(*) INTO v_total_plays FROM public.minigame_scores;
  v_pool_size := v_base_pool + (v_total_plays * 2);

  -- 6. Calculate Rank
  -- Rank is based on best score of each user
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

  -- 8. Distribute Reward
  IF v_payout_ratio > 0 THEN
      v_reward_amount := FLOOR(v_pool_size * v_payout_ratio);
      
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
  ELSE
      -- Update Profile Cooldown (Even if no reward? No, only if they claim a reward? 
      -- Wait, if they are not in top 10, they get 0. 
      -- User said: "allow 60min cooldown for a bonus-claiming trial". 
      -- If they didn't win, maybe we don't trigger cooldown? 
      -- But then they can spam until they win. 
      -- Let's stick to: If you play, you use your "reward attempt". 
      -- Actually, if they are not Top 10, v_reward_amount is 0.
      -- Let's just say cooldown triggers if they successfully complete a game run that *could* have rewarded them.
      
      UPDATE public.profiles 
      SET last_minigame_reward_at = NOW() 
      WHERE id = v_user_id;

      RETURN jsonb_build_object(
          'success', true, 
          'message', 'Score updated! Keep trying for Top 10.', 
          'reward', 0
      );
  END IF;
END;
$$;
