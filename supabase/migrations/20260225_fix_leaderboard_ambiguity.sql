-- Fix function ambiguity by dropping all known variants
DROP FUNCTION IF EXISTS public.get_monthly_leaderboard(integer, integer);
DROP FUNCTION IF EXISTS public.get_monthly_leaderboard(text, integer, integer);
DROP FUNCTION IF EXISTS public.get_monthly_leaderboard(integer, integer, text);

-- Recreate with consistent signature and add avatar_url
CREATE OR REPLACE FUNCTION public.get_monthly_leaderboard(
    p_game_type TEXT DEFAULT 'REACTION',
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    avatar_url TEXT,
    best_score INTEGER,
    rank BIGINT,
    total_plays BIGINT,
    last_played_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH UserScores AS (
        SELECT 
            ms.user_id,
            MIN(ms.score_ms) as min_score,
            COUNT(*) as total_count,
            MAX(ms.created_at) as last_played
        FROM public.minigame_scores ms
        WHERE 
            EXTRACT(YEAR FROM ms.created_at) = p_year
            AND EXTRACT(MONTH FROM ms.created_at) = p_month
            AND ms.game_type = p_game_type
        GROUP BY ms.user_id
    )
    SELECT 
        us.user_id,
        COALESCE(p.username, 'Anonymous') as username,
        p.avatar_url,
        us.min_score as best_score,
        RANK() OVER (ORDER BY us.min_score ASC) as rank,
        us.total_count as total_plays,
        us.last_played as last_played_at
    FROM UserScores us
    LEFT JOIN public.profiles p ON us.user_id = p.id
    ORDER BY us.min_score ASC
    LIMIT 100;
END;
$$;

-- Also update the reward distribution to match "Best Score" logic (Single Best)
CREATE OR REPLACE FUNCTION distribute_monthly_minigame_rewards(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_start_date TIMESTAMPTZ := make_timestamp(p_year, p_month, 1, 0, 0, 0);
    v_end_date TIMESTAMPTZ := v_start_date + INTERVAL '1 month';
    v_game_types TEXT[] := ARRAY['REACTION', 'PIT_STOP'];
    v_game_type TEXT;
    v_pool_data JSONB;
    v_total_pool INTEGER;
    v_leaderboard RECORD;
    v_reward INTEGER;
    v_processed_users JSONB := '[]'::JSONB;
    v_count INTEGER := 0;
BEGIN
    FOREACH v_game_type IN ARRAY v_game_types
    LOOP
        -- 1. Get Pool Size for this game
        v_pool_data := get_monthly_prize_pool(v_game_type, p_year, p_month);
        v_total_pool := (v_pool_data->>'dynamic_pool')::INTEGER;
        
        -- 2. Calculate Leaderboard (Best Score)
        FOR v_leaderboard IN
            WITH UserStats AS (
                SELECT 
                    user_id,
                    MIN(score_ms) as best_score,
                    COUNT(*) as total_plays
                FROM public.minigame_scores
                WHERE created_at >= v_start_date AND created_at < v_end_date
                  AND game_type = v_game_type
                GROUP BY user_id
            ),
            RankedUsers AS (
                SELECT 
                    user_id,
                    best_score,
                    RANK() OVER (ORDER BY best_score ASC) as rank
                FROM UserStats
            )
            SELECT * FROM RankedUsers WHERE rank <= 10 ORDER BY rank ASC
        LOOP
            -- 3. Strict Reward Distribution
            -- 25%, 18%, 15%, 12%, 10%, 8%, 6%, 4%, 2%
            v_reward := 0;
            
            IF v_leaderboard.rank = 1 THEN v_reward := FLOOR(v_total_pool * 0.25);
            ELSIF v_leaderboard.rank = 2 THEN v_reward := FLOOR(v_total_pool * 0.18);
            ELSIF v_leaderboard.rank = 3 THEN v_reward := FLOOR(v_total_pool * 0.15);
            ELSIF v_leaderboard.rank = 4 THEN v_reward := FLOOR(v_total_pool * 0.12);
            ELSIF v_leaderboard.rank = 5 THEN v_reward := FLOOR(v_total_pool * 0.10);
            ELSIF v_leaderboard.rank = 6 THEN v_reward := FLOOR(v_total_pool * 0.08);
            ELSIF v_leaderboard.rank = 7 THEN v_reward := FLOOR(v_total_pool * 0.06);
            ELSIF v_leaderboard.rank = 8 THEN v_reward := FLOOR(v_total_pool * 0.04);
            ELSIF v_leaderboard.rank = 9 THEN v_reward := FLOOR(v_total_pool * 0.02);
            -- Rank 10 gets 0% (Remainder)
            END IF;

            -- 4. Distribute
            IF v_reward > 0 THEN
                UPDATE public.wallets 
                SET token_balance = token_balance + v_reward 
                WHERE user_id = v_leaderboard.user_id;
                
                INSERT INTO public.ledger_entries (
                    wallet_id, amount, currency, operation_type, description
                )
                SELECT 
                    id, v_reward, 'TOKEN', 'REWARD', 
                    v_game_type || ' Monthly Reward: Rank #' || v_leaderboard.rank || ' (Score: ' || v_leaderboard.best_score || 'ms)'
                FROM public.wallets 
                WHERE user_id = v_leaderboard.user_id;
                
                v_processed_users := v_processed_users || jsonb_build_object(
                    'user_id', v_leaderboard.user_id,
                    'game_type', v_game_type,
                    'rank', v_leaderboard.rank,
                    'reward', v_reward,
                    'best_score', v_leaderboard.best_score
                );
                v_count := v_count + 1;
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true, 
        'recipients_count', v_count,
        'details', v_processed_users
    );
END;
$$;
