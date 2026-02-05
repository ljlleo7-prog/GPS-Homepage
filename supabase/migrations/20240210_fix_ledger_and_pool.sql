-- Fix ledger_entries constraint
ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_operation_type_check;

ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_operation_type_check 
    CHECK (operation_type IN (
        'MINT', 'BURN', 'TRANSFER', 'REWARD', 'MARKET_ENTRY', 'MARKET_PAYOUT', 
        'SYSTEM', 'BUY_BET', 'BET_INCOME', 'BANKRUPTCY', 'BET_PAYOUT', 'WIN', 
        'TRADE_BUY', 'TRADE_SELL', 'GAME_REWARD'
    ));

-- Update Minigame Prize Pool Base to 500
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
    v_base_pool INTEGER := 500; -- Updated to 500
    v_token_per_play INTEGER := 2;
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
