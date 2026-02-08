-- ==============================================================================
-- RECOVER LOST TICKETS (From 20260208 Backup)
-- Description: Reconstructs missing ticket_types from support_instruments and balances
-- ==============================================================================

DO $$
DECLARE
    v_count integer := 0;
BEGIN
    RAISE NOTICE 'Starting Emergency Ticket Recovery...';

    -- 1. Ensure Tables Exist
    CREATE TABLE IF NOT EXISTS public.ticket_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        description TEXT,
        total_supply INTEGER,
        creator_id UUID REFERENCES public.profiles(id),
        instrument_id UUID, -- References support_instruments(id)
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Ensure instrument_id column exists (in case table existed but column didn't)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ticket_types' AND column_name = 'instrument_id') THEN
        ALTER TABLE public.ticket_types ADD COLUMN instrument_id UUID;
    END IF;

    CREATE TABLE IF NOT EXISTS public.user_ticket_balances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
        ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE CASCADE NOT NULL,
        balance INTEGER DEFAULT 0 CHECK (balance >= 0),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, ticket_type_id)
    );

    -- 2. Reconstruct Ticket Types from Support Instruments (Driver Bets)
    -- Side A
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'ticket_type_a_id') THEN
        INSERT INTO public.ticket_types (id, title, description, total_supply, creator_id, instrument_id)
        SELECT 
            b.ticket_type_a_id,
            b.title || ' - ' || COALESCE(b.side_a_name, 'Side A'),
            'Driver Bet Ticket: ' || COALESCE(b.side_a_name, 'Side A'),
            b.ticket_limit,
            CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = b.creator_id) THEN b.creator_id ELSE NULL END,
            b.id
        FROM backup_support_instruments_20260208 b
        WHERE b.ticket_type_a_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING;
        
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Recovered % Driver Bet Tickets (Side A)', v_count;
    END IF;

    -- Side B
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'ticket_type_b_id') THEN
        INSERT INTO public.ticket_types (id, title, description, total_supply, creator_id, instrument_id)
        SELECT 
            b.ticket_type_b_id,
            b.title || ' - ' || COALESCE(b.side_b_name, 'Side B'),
            'Driver Bet Ticket: ' || COALESCE(b.side_b_name, 'Side B'),
            b.ticket_limit,
            CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = b.creator_id) THEN b.creator_id ELSE NULL END,
            b.id
        FROM backup_support_instruments_20260208 b
        WHERE b.ticket_type_b_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Recovered % Driver Bet Tickets (Side B)', v_count;
    END IF;

    -- 3. Reconstruct Ticket Types from Support Instruments (Regular Campaigns)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'ticket_type_id') THEN
        INSERT INTO public.ticket_types (id, title, description, total_supply, creator_id, instrument_id)
        SELECT 
            b.ticket_type_id,
            b.title,
            b.description,
            NULL, -- Unlimited supply usually
            CASE WHEN EXISTS (SELECT 1 FROM public.profiles WHERE id = b.creator_id) THEN b.creator_id ELSE NULL END,
            b.id
        FROM backup_support_instruments_20260208 b
        WHERE b.ticket_type_id IS NOT NULL
        AND b.is_driver_bet IS FALSE -- Avoid duplicates if logic overlaps (though columns differ)
        ON CONFLICT (id) DO NOTHING;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Recovered % Campaign Tickets', v_count;
    END IF;

    -- 4. Reconstruct Unknown Ticket Types from Balances (Ghost Tickets)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_user_ticket_balances_20260208') THEN
        INSERT INTO public.ticket_types (id, title, description, creator_id)
        SELECT DISTINCT 
            b.ticket_type_id,
            'Recovered Ticket ' || SUBSTR(b.ticket_type_id::text, 1, 8),
            'Restored from balance backup (metadata lost)',
            NULL::uuid
        FROM backup_user_ticket_balances_20260208 b
        WHERE NOT EXISTS (SELECT 1 FROM public.ticket_types WHERE id = b.ticket_type_id)
        ON CONFLICT (id) DO NOTHING;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Recovered % Ghost Tickets from Balances', v_count;
    END IF;

    -- 5. Restore User Ticket Balances
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_user_ticket_balances_20260208') THEN
        INSERT INTO public.user_ticket_balances (id, user_id, ticket_type_id, balance, created_at, updated_at)
        SELECT 
            b.id, 
            b.user_id, 
            b.ticket_type_id, 
            b.balance, 
            b.created_at, 
            b.updated_at
        FROM backup_user_ticket_balances_20260208 b
        WHERE EXISTS (SELECT 1 FROM public.profiles WHERE id = b.user_id) -- User must exist
        AND EXISTS (SELECT 1 FROM public.ticket_types WHERE id = b.ticket_type_id) -- Ticket must exist (we just restored them)
        ON CONFLICT (id) DO UPDATE SET
            balance = EXCLUDED.balance,
            updated_at = EXCLUDED.updated_at;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RAISE NOTICE 'Restored % User Ticket Balances', v_count;
    END IF;

    RAISE NOTICE 'Emergency Ticket Recovery Completed.';
END $$;
