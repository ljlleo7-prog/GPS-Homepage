-- Fix ledger_entries constraint to include 'GAME_COST'
ALTER TABLE public.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_operation_type_check;

ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_operation_type_check 
    CHECK (operation_type IN (
        'MINT', 'BURN', 'TRANSFER', 'REWARD', 'MARKET_ENTRY', 'MARKET_PAYOUT', 
        'SYSTEM', 'BUY_BET', 'BET_INCOME', 'BANKRUPTCY', 'BET_PAYOUT', 'WIN', 
        'TRADE_BUY', 'TRADE_SELL', 'GAME_REWARD', 'GAME_COST'
    ));
