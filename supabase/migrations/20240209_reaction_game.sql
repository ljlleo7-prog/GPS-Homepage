
-- Create Minigame Scores table
CREATE TABLE IF NOT EXISTS public.minigame_scores (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    game_type TEXT NOT NULL, -- 'REACTION'
    score_ms INTEGER NOT NULL, -- Reaction time in ms
    reward_amount INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_minigame_scores_user_created ON public.minigame_scores(user_id, created_at DESC);

-- RPC to submit score
CREATE OR REPLACE FUNCTION play_reaction_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_last_played TIMESTAMPTZ;
    v_reward INTEGER;
    v_wallet_id UUID;
    v_cooldown_minutes INTEGER := 60;
    v_minutes_remaining INTEGER;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
    END IF;

    -- Check cooldown
    SELECT created_at INTO v_last_played
    FROM public.minigame_scores
    WHERE user_id = v_user_id AND game_type = 'REACTION'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_played IS NOT NULL AND v_last_played > NOW() - (v_cooldown_minutes || ' minutes')::INTERVAL THEN
         v_minutes_remaining := EXTRACT(EPOCH FROM (v_last_played + (v_cooldown_minutes || ' minutes')::INTERVAL - NOW())) / 60;
         RETURN jsonb_build_object('success', false, 'message', 'Cooldown active. Try again in ' || v_minutes_remaining || ' minutes.');
    END IF;

    -- Calculate Reward
    IF p_score_ms < 200 THEN
        v_reward := 50; -- Superhuman (or cheating, but let's allow it for fun/luck)
    ELSIF p_score_ms < 300 THEN
        v_reward := 10; -- F1 Driver level
    ELSIF p_score_ms < 400 THEN
        v_reward := 5; -- Decent
    ELSIF p_score_ms < 600 THEN
        v_reward := 2; -- Average
    ELSE
        v_reward := 1; -- Participation
    END IF;
    
    -- Insert Score
    INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount)
    VALUES (v_user_id, 'REACTION', p_score_ms, v_reward);

    -- Update Wallet
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id;
    
    -- Ensure wallet exists (safety)
    IF v_wallet_id IS NULL THEN
        PERFORM ensure_wallet_exists();
        SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id;
    END IF;

    UPDATE public.wallets
    SET token_balance = token_balance + v_reward
    WHERE id = v_wallet_id;

    -- Ledger Entry
    INSERT INTO public.ledger_entries (wallet_id, amount, currency, operation_type, description)
    VALUES (v_wallet_id, v_reward, 'TOKEN', 'GAME_REWARD', 'F1 Reaction Test Reward: ' || p_score_ms || 'ms');

    RETURN jsonb_build_object('success', true, 'reward', v_reward, 'message', 'You earned ' || v_reward || ' tokens!');
END;
$$;
