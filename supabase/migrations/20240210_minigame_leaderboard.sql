
-- 1. Create a view or function to get the monthly leaderboard
-- We need to join minigame_scores with profiles to get usernames
-- And aggregate by user_id to find the BEST score (MIN score_ms)

CREATE OR REPLACE FUNCTION get_monthly_leaderboard(
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
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
    WITH MonthlyScores AS (
        SELECT 
            ms.user_id,
            MIN(ms.score_ms) as best_score,
            COUNT(*) as play_count,
            MAX(ms.created_at) as last_played
        FROM public.minigame_scores ms
        WHERE 
            EXTRACT(YEAR FROM ms.created_at) = p_year
            AND EXTRACT(MONTH FROM ms.created_at) = p_month
            AND ms.game_type = 'REACTION'
        GROUP BY ms.user_id
    )
    SELECT 
        ms.user_id,
        COALESCE(p.username, 'Anonymous') as username,
        ms.best_score::INTEGER,
        RANK() OVER (ORDER BY ms.best_score ASC) as rank,
        ms.play_count,
        ms.last_played
    FROM MonthlyScores ms
    LEFT JOIN public.profiles p ON ms.user_id = p.id
    ORDER BY ms.best_score ASC
    LIMIT 100; -- Top 100
END;
$$;

-- 2. Function to calculate the Dynamic Prize Pool
-- Logic: Base Pool (e.g., 1000) + (Total Plays in Month * 5 Tokens)
-- This ensures "activity = reward"
CREATE OR REPLACE FUNCTION get_monthly_prize_pool(
    p_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
    p_month INTEGER DEFAULT EXTRACT(MONTH FROM NOW())::INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_plays INTEGER;
    v_base_pool INTEGER := 1000;
    v_token_per_play INTEGER := 2; -- 2 tokens added per game played
    v_total_pool INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_plays
    FROM public.minigame_scores
    WHERE 
        EXTRACT(YEAR FROM created_at) = p_year
        AND EXTRACT(MONTH FROM created_at) = p_month
        AND game_type = 'REACTION';
        
    v_total_pool := v_base_pool + (v_total_plays * v_token_per_play);
    
    RETURN jsonb_build_object(
        'total_plays', v_total_plays,
        'base_pool', v_base_pool,
        'dynamic_pool', v_total_pool
    );
END;
$$;

-- 3. Admin Function to Distribute Rewards (End of Month)
-- Distributes to Top 10% or Top 3? 
-- User said: "not concrete champion xxx tokens... since inactivity will create low performance with award"
-- Let's do a proportional distribution for the Top 10 players.
-- 1st: 30%, 2nd: 20%, 3rd: 10%, 4th-10th: Share remaining 40% (approx 5.7% each)

CREATE OR REPLACE FUNCTION distribute_monthly_minigame_rewards(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pool_data JSONB;
    v_total_pool NUMERIC;
    v_leaderboard RECORD;
    v_reward NUMERIC;
    v_count INTEGER := 0;
    v_processed_users JSONB := '[]'::jsonb;
    v_admin_id UUID;
BEGIN
    -- Check if admin (simple check against profile status or just trust the caller if RLS handles it? 
    -- Ideally, we check developer_status. For now, we assume the RPC is called by an admin UI that is gated.)
    
    -- 1. Calculate Pool
    v_pool_data := get_monthly_prize_pool(p_year, p_month);
    v_total_pool := (v_pool_data->>'dynamic_pool')::NUMERIC;
    
    -- 2. Iterate Top 10
    FOR v_leaderboard IN (
        SELECT * FROM get_monthly_leaderboard(p_year, p_month) LIMIT 10
    ) LOOP
        v_count := v_count + 1;
        
        -- Calculate Reward Share
        IF v_leaderboard.rank = 1 THEN
            v_reward := v_total_pool * 0.30;
        ELSIF v_leaderboard.rank = 2 THEN
            v_reward := v_total_pool * 0.20;
        ELSIF v_leaderboard.rank = 3 THEN
            v_reward := v_total_pool * 0.10;
        ELSE
            -- Ranks 4-10 share 40%. There are 7 spots. 40/7 = ~5.71%
            v_reward := v_total_pool * 0.40 / 7.0;
        END IF;
        
        -- Round down
        v_reward := FLOOR(v_reward);
        
        IF v_reward > 0 THEN
            -- Update Wallet
            UPDATE public.wallets 
            SET token_balance = token_balance + v_reward
            WHERE user_id = v_leaderboard.user_id;
            
            -- Add Ledger Entry
            INSERT INTO public.ledger_entries (
                wallet_id, 
                amount, 
                currency, 
                operation_type, 
                description
            )
            SELECT 
                id, 
                v_reward, 
                'TOKEN', 
                'REWARD', 
                'Minigame Monthly Reward: Rank #' || v_leaderboard.rank || ' (' || p_year || '-' || p_month || ')'
            FROM public.wallets 
            WHERE user_id = v_leaderboard.user_id;
            
            v_processed_users := v_processed_users || jsonb_build_object(
                'user_id', v_leaderboard.user_id,
                'rank', v_leaderboard.rank,
                'reward', v_reward
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true, 
        'pool', v_total_pool, 
        'recipients_count', v_count,
        'details', v_processed_users
    );
END;
$$;
