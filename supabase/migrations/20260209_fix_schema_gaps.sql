-- Fix missing columns and retry restoration for Forum/Market
-- Date: 2026-02-09

DO $$
BEGIN
    -- 1. Fix Profiles Table (Add missing column)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'last_minigame_reward_at') THEN
        ALTER TABLE public.profiles ADD COLUMN last_minigame_reward_at TIMESTAMPTZ;
        RAISE NOTICE 'Added last_minigame_reward_at to profiles';
    END IF;

    -- 2. Retry Forum Posts Restoration (with FK safety)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_forum_posts_20260208') THEN
        -- Patch backup table if needed (reward_amount)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_forum_posts_20260208' AND column_name = 'reward_amount') THEN
            ALTER TABLE public.backup_forum_posts_20260208 ADD COLUMN reward_amount NUMERIC(20, 2) DEFAULT 0;
        END IF;

        INSERT INTO public.forum_posts (id, title, content, author_id, is_featured, reward_amount, created_at, updated_at)
        SELECT 
            id, 
            title, 
            content, 
            author_id, 
            is_featured, 
            reward_amount, 
            created_at, 
            updated_at
        FROM backup_forum_posts_20260208
        WHERE author_id IN (SELECT id FROM public.profiles) -- Only restore if author exists
        ON CONFLICT (id) DO NOTHING;
        
        RAISE NOTICE 'Retried Forum Posts Restoration (Safe Mode)';
    END IF;

    -- 3. Retry Support Instruments Restoration (with FK safety and Type Mapping)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_support_instruments_20260208') THEN
        -- Patch backup table columns
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'yield_rate') THEN
            ALTER TABLE public.backup_support_instruments_20260208 ADD COLUMN yield_rate NUMERIC(5, 2) DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'lockup_period_days') THEN
            ALTER TABLE public.backup_support_instruments_20260208 ADD COLUMN lockup_period_days INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'risk_level') THEN
            ALTER TABLE public.backup_support_instruments_20260208 ADD COLUMN risk_level TEXT DEFAULT 'LOW';
        END IF;

        INSERT INTO public.support_instruments (id, title, description, type, risk_level, yield_rate, status, lockup_period_days, created_at)
        SELECT 
            id, 
            title, 
            description, 
            CASE 
                WHEN type = 'MARKET' THEN 'MILESTONE' 
                WHEN type IN ('BOND', 'INDEX', 'MILESTONE') THEN type
                ELSE 'MILESTONE' 
            END,
            COALESCE(risk_level, 'LOW'), 
            yield_rate, 
            status, 
            lockup_period_days, 
            created_at
        FROM backup_support_instruments_20260208
        WHERE creator_id IN (SELECT id FROM public.profiles) -- Only restore if creator exists
        ON CONFLICT (id) DO NOTHING;
        
        RAISE NOTICE 'Retried Support Instruments Restoration (Safe Mode)';
    END IF;

    -- 4. Retry Support Positions Restoration (Market Holdings)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_support_positions_20260208') THEN
        INSERT INTO public.support_positions (id, instrument_id, user_id, amount_invested, status, payout_amount, bet_selection, created_at, updated_at)
        SELECT 
            id, instrument_id, user_id, amount_invested, status, payout_amount, bet_selection, created_at, updated_at
        FROM backup_support_positions_20260208
        WHERE user_id IN (SELECT id FROM public.profiles)
        AND instrument_id IN (SELECT id FROM public.support_instruments)
        ON CONFLICT (id) DO NOTHING;
        
        RAISE NOTICE 'Retried Support Positions Restoration (Safe Mode)';
    END IF;

END $$;
