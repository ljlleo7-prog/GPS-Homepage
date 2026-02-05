CREATE OR REPLACE FUNCTION play_reaction_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_last_rewarded_at TIMESTAMPTZ;
    v_reward INTEGER;
    v_actual_reward INTEGER;
    v_wallet_id UUID;
    v_cooldown_minutes INTEGER := 60;
    v_minutes_remaining INTEGER;
    v_on_cooldown BOOLEAN := false;
    v_message TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    -- ANTI-CHEAT: 100ms Jump Start
    IF p_score_ms < 100 THEN
         RETURN jsonb_build_object(
             'success', false, 
             'message', 'JUMP START! Reactions under 100ms are physically impossible.',
             'jump_start', true
         );
    END IF;

    -- 1. Check Cooldown (Look for last play with reward > 0)
    SELECT created_at INTO v_last_rewarded_at
    FROM public.minigame_scores
    WHERE user_id = v_user_id 
        AND game_type = 'REACTION'
        AND reward_amount > 0 -- Only check rewarded plays
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_rewarded_at IS NOT NULL AND v_last_rewarded_at > NOW() - (v_cooldown_minutes || ' minutes')::INTERVAL THEN
         v_on_cooldown := true;
         v_minutes_remaining := EXTRACT(EPOCH FROM (v_last_rewarded_at + (v_cooldown_minutes || ' minutes')::INTERVAL - NOW())) / 60;
    END IF;

    -- 2. Calculate Potential Reward
    IF p_score_ms < 200 THEN
        v_reward := 50; 
    ELSIF p_score_ms < 300 THEN
        v_reward := 10;
    ELSIF p_score_ms < 400 THEN
        v_reward := 5;
    ELSIF p_score_ms < 600 THEN
        v_reward := 2;
    ELSE
        v_reward := 1;
    END IF;
    
    -- 3. Determine Actual Reward based on Cooldown
    IF v_on_cooldown THEN
        v_actual_reward := 0;
        v_message := 'Score updated! Reward cooldown active (' || v_minutes_remaining || 'm left).';
    ELSE
        v_actual_reward := v_reward;
        v_message := 'New Record! You earned ' || v_reward || ' tokens!';
    END IF;

    -- 4. Insert Score (Always insert, so leaderboard updates)
    INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount)
    VALUES (v_user_id, 'REACTION', p_score_ms, v_actual_reward);

    -- 5. Update Wallet & Ledger (Only if reward > 0)
    IF v_actual_reward > 0 THEN
        SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id;
        
        -- Ensure wallet exists (safety)
        IF v_wallet_id IS NULL THEN
            PERFORM ensure_wallet_exists();
            SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id;
        END IF;

        UPDATE public.wallets
        SET token_balance = token_balance + v_actual_reward
        WHERE id = v_wallet_id;

        -- Ledger Entry
        INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
        VALUES (v_wallet_id, v_actual_reward, 'TOKEN', 'GAME_REWARD', 'F1 Reaction Test Reward: ' || p_score_ms || 'ms');
    END IF;

    RETURN jsonb_build_object(
        'success', true, 
        'reward', v_actual_reward, 
        'message', v_message,
        'on_cooldown', v_on_cooldown
    );
END;
$$;
