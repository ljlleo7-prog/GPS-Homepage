-- ==============================================================================
-- FIX DRIVER BETS DATA & TYPES
-- Description: Restores missing driver bet columns and restores 'MARKET' type
-- ==============================================================================

-- 1. Add Missing Driver Bet Columns
DO $$
BEGIN
    -- ticket_price
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'ticket_price') THEN
        ALTER TABLE public.support_instruments ADD COLUMN ticket_price NUMERIC DEFAULT 1.0;
    END IF;
    
    -- ticket_limit
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'ticket_limit') THEN
        ALTER TABLE public.support_instruments ADD COLUMN ticket_limit INTEGER;
    END IF;
    
    -- open_date
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'open_date') THEN
        ALTER TABLE public.support_instruments ADD COLUMN open_date TIMESTAMPTZ;
    END IF;
    
    -- winning_side
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'winning_side') THEN
        ALTER TABLE public.support_instruments ADD COLUMN winning_side TEXT;
    END IF;
    
    -- resolution_status (Note: status column exists, but resolution_status is specific to driver bets distinct from general status? 
    -- driver_bets.sql line 14: ADD COLUMN resolution_status TEXT DEFAULT 'OPEN';
    -- clean_rebuild.sql has 'status'. Let's check if we need resolution_status.
    -- Yes, driver_bets.sql added it. It might track bet outcome distinct from instrument lifecycle.)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'resolution_status') THEN
        ALTER TABLE public.support_instruments ADD COLUMN resolution_status TEXT DEFAULT 'OPEN';
    END IF;
END $$;

-- 2. Update Type Constraint to allow 'MARKET'
DO $$
BEGIN
    -- Check if constraint exists and drop it to allow 'MARKET' type
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'support_instruments_type_check' AND table_name = 'support_instruments') THEN
        ALTER TABLE public.support_instruments DROP CONSTRAINT support_instruments_type_check;
    END IF;

    -- Add new constraint including 'MARKET'
    ALTER TABLE public.support_instruments 
    ADD CONSTRAINT support_instruments_type_check 
    CHECK (type IN ('BOND', 'INDEX', 'MILESTONE', 'MARKET'));
    
    RAISE NOTICE 'Updated support_instruments_type_check to include MARKET';
END $$;

-- 2. Restore Driver Bet & Market Data from Backup
DO $$
DECLARE
    v_count integer := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_support_instruments_20260208') THEN
        
        -- Restore specific Driver Bet columns and Type
        -- We perform a bulk update joining with backup
        UPDATE public.support_instruments i
        SET 
            -- Restore Type (was converted to MILESTONE in clean_rebuild)
            type = CASE 
                WHEN b.type = 'MARKET' THEN 'MARKET'
                ELSE i.type 
            END,
            
            -- Restore Driver Bet Flags & Data
            is_driver_bet = COALESCE(b.is_driver_bet, false),
            side_a_name = b.side_a_name,
            side_b_name = b.side_b_name,
            official_end_date = b.official_end_date,
            open_date = b.open_date,
            
            -- Restore Ticket Links (Critical for Driver Bets)
            ticket_type_a_id = b.ticket_type_a_id,
            ticket_type_b_id = b.ticket_type_b_id,
            ticket_price = b.ticket_price,
            ticket_limit = b.ticket_limit,
            
            -- Restore Resolution State
            resolution_status = COALESCE(b.resolution_status, 'OPEN'),
            winning_side = b.winning_side,
            
            -- Restore Risk Level (Driver Bets are usually HIGH)
            risk_level = COALESCE(b.risk_level, i.risk_level)
            
        FROM backup_support_instruments_20260208 b
        WHERE i.id = b.id
        AND (
            b.is_driver_bet = true 
            OR b.type = 'MARKET'
        );
        
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Restored Data for % Instruments (Driver Bets/Market)', v_count;
        
    END IF;
END $$;
