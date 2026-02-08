-- ==============================================================================
-- FIX INSTRUMENTS AND RESTORE RLS
-- Description: Adds missing columns to support_instruments and resets RLS policies
-- ==============================================================================

-- 1. Add Missing Columns to support_instruments
-- These columns were introduced in 20240207_marketing_overhaul.sql but missing in clean rebuild
DO $$
BEGIN
    -- deletion_status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'deletion_status') THEN
        ALTER TABLE public.support_instruments 
        ADD COLUMN deletion_status TEXT DEFAULT 'ACTIVE' CHECK (deletion_status IN ('ACTIVE', 'DELISTED_MARKET', 'DELETED_EVERYWHERE'));
    END IF;

    -- refund_schedule
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'refund_schedule') THEN
        ALTER TABLE public.support_instruments 
        ADD COLUMN refund_schedule JSONB DEFAULT '[]'::JSONB;
    END IF;

    -- ticket_type_id (for non-driver bet campaigns)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_instruments' AND column_name = 'ticket_type_id') THEN
        ALTER TABLE public.support_instruments 
        ADD COLUMN ticket_type_id UUID REFERENCES public.ticket_types(id);
    END IF;
    
    RAISE NOTICE 'Added missing columns to support_instruments';
END $$;

-- 2. Restore Data for New Columns (from Backup if available)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'backup_support_instruments_20260208') THEN
        -- Update deletion_status
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'deletion_status') THEN
            UPDATE public.support_instruments i
            SET deletion_status = b.deletion_status
            FROM backup_support_instruments_20260208 b
            WHERE i.id = b.id AND b.deletion_status IS NOT NULL;
        END IF;

        -- Update refund_schedule
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'refund_schedule') THEN
            UPDATE public.support_instruments i
            SET refund_schedule = b.refund_schedule
            FROM backup_support_instruments_20260208 b
            WHERE i.id = b.id AND b.refund_schedule IS NOT NULL;
        END IF;

        -- Update ticket_type_id
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'backup_support_instruments_20260208' AND column_name = 'ticket_type_id') THEN
            UPDATE public.support_instruments i
            SET ticket_type_id = b.ticket_type_id
            FROM backup_support_instruments_20260208 b
            WHERE i.id = b.id AND b.ticket_type_id IS NOT NULL;
        END IF;
        
        RAISE NOTICE 'Restored data for new columns from backup';
    END IF;
END $$;

-- 3. RESET RLS POLICIES (Drop All & Re-create)
-- This ensures a clean slate for security policies

-- Disable RLS temporarily to avoid locking issues during policy drop
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_articles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_instruments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_positions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.minigame_scores DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_types DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_listings DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ticket_balances DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_transactions DISABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Public Read" ON public.profiles;
DROP POLICY IF EXISTS "Own Profile Edit" ON public.profiles;

DROP POLICY IF EXISTS "Own Wallet View" ON public.wallets;

DROP POLICY IF EXISTS "Own Ledger View" ON public.ledger_entries;

DROP POLICY IF EXISTS "Public Read" ON public.news_articles;

DROP POLICY IF EXISTS "Public Read" ON public.news_comments;
DROP POLICY IF EXISTS "Comment Own" ON public.news_comments;
DROP POLICY IF EXISTS "Delete Own Comment" ON public.news_comments;

DROP POLICY IF EXISTS "Public Read" ON public.forum_posts;
DROP POLICY IF EXISTS "Forum Post Create" ON public.forum_posts;
DROP POLICY IF EXISTS "Forum Post Edit" ON public.forum_posts;
DROP POLICY IF EXISTS "Forum Post Delete" ON public.forum_posts;

DROP POLICY IF EXISTS "Public Read" ON public.missions;

DROP POLICY IF EXISTS "Mission Submissions Own" ON public.mission_submissions;
DROP POLICY IF EXISTS "Mission Submissions Create" ON public.mission_submissions;

DROP POLICY IF EXISTS "Public Read" ON public.support_instruments;

DROP POLICY IF EXISTS "Support Positions Own" ON public.support_positions;

DROP POLICY IF EXISTS "Public Read" ON public.minigame_scores;
DROP POLICY IF EXISTS "Minigame Score Insert" ON public.minigame_scores;

DROP POLICY IF EXISTS "Public Read Ticket Types" ON public.ticket_types;

DROP POLICY IF EXISTS "Public Read Active Listings" ON public.ticket_listings;
DROP POLICY IF EXISTS "Own Listings" ON public.ticket_listings;
DROP POLICY IF EXISTS "Create Own Listing" ON public.ticket_listings;
DROP POLICY IF EXISTS "Update Own Listing" ON public.ticket_listings;

DROP POLICY IF EXISTS "Own Ticket Balances" ON public.user_ticket_balances;

DROP POLICY IF EXISTS "Own Transactions" ON public.ticket_transactions;

-- Re-Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mission_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minigame_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ticket_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_transactions ENABLE ROW LEVEL SECURITY;

-- 4. Create Policies

-- Profiles
CREATE POLICY "Public Read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Own Profile Edit" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Wallets
CREATE POLICY "Own Wallet View" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- Ledger
CREATE POLICY "Own Ledger View" ON public.ledger_entries FOR SELECT USING (wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid()));

-- News
CREATE POLICY "Public Read" ON public.news_articles FOR SELECT USING (true);

-- Comments
CREATE POLICY "Public Read" ON public.news_comments FOR SELECT USING (true);
CREATE POLICY "Comment Own" ON public.news_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Delete Own Comment" ON public.news_comments FOR DELETE USING (auth.uid() = user_id);

-- Forum
CREATE POLICY "Public Read" ON public.forum_posts FOR SELECT USING (true);
CREATE POLICY "Forum Post Create" ON public.forum_posts FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Forum Post Edit" ON public.forum_posts FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "Forum Post Delete" ON public.forum_posts FOR DELETE USING (auth.uid() = author_id);

-- Missions
CREATE POLICY "Public Read" ON public.missions FOR SELECT USING (true);

-- Mission Submissions
CREATE POLICY "Mission Submissions Own" ON public.mission_submissions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Mission Submissions Create" ON public.mission_submissions FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Support Instruments
CREATE POLICY "Public Read" ON public.support_instruments FOR SELECT USING (true);

-- Support Positions
CREATE POLICY "Support Positions Own" ON public.support_positions FOR SELECT USING (auth.uid() = user_id);

-- Minigame Scores
CREATE POLICY "Public Read" ON public.minigame_scores FOR SELECT USING (true);
CREATE POLICY "Minigame Score Insert" ON public.minigame_scores FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Ticket Types
CREATE POLICY "Public Read Ticket Types" ON public.ticket_types FOR SELECT USING (true);

-- Ticket Listings
CREATE POLICY "Public Read Active Listings" ON public.ticket_listings FOR SELECT USING (status = 'ACTIVE' OR auth.uid() = seller_id);
CREATE POLICY "Create Own Listing" ON public.ticket_listings FOR INSERT WITH CHECK (auth.uid() = seller_id);
CREATE POLICY "Update Own Listing" ON public.ticket_listings FOR UPDATE USING (auth.uid() = seller_id);
CREATE POLICY "Delete Own Listing" ON public.ticket_listings FOR DELETE USING (auth.uid() = seller_id);

-- Ticket Balances
CREATE POLICY "Own Ticket Balances" ON public.user_ticket_balances FOR SELECT USING (auth.uid() = user_id);

-- Ticket Transactions
CREATE POLICY "Own Transactions" ON public.ticket_transactions FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

RAISE NOTICE 'RLS Policies Restored Successfully';
