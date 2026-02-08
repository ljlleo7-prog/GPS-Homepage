-- ==============================================================================
-- FIX PERMISSIONS & SCHEMA
-- Description: Adds missing columns and RLS policies for creators/high-rep users
-- ==============================================================================

-- 1. SCHEMA FIXES
-- Add 'deadline' to missions (User reported error)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'deadline') THEN
        ALTER TABLE public.missions ADD COLUMN deadline TIMESTAMPTZ;
        RAISE NOTICE 'Added deadline column to missions';
    END IF;
END $$;

-- 2. RLS POLICY UPDATES

-- 2.1 Ticket Holder Visibility for Creators
-- Problem: Creators cannot see who holds their tickets.
-- Fix: Allow SELECT on user_ticket_balances if the user is the creator of the ticket type.
DROP POLICY IF EXISTS "Creator View Ticket Holders" ON public.user_ticket_balances;
CREATE POLICY "Creator View Ticket Holders" ON public.user_ticket_balances
    FOR SELECT
    USING (
        ticket_type_id IN (
            SELECT id FROM public.ticket_types WHERE creator_id = auth.uid()
        )
    );

-- 2.2 Mission Creation
-- Problem: Users cannot create missions.
-- Fix: Allow INSERT for authenticated users (Optional: Enforce Reputation > 50)
DROP POLICY IF EXISTS "Mission Create" ON public.missions;
CREATE POLICY "Mission Create" ON public.missions
    FOR INSERT
    WITH CHECK (
        auth.role() = 'authenticated' AND
        EXISTS (
            SELECT 1 FROM public.wallets 
            WHERE user_id = auth.uid() 
            AND reputation_balance >= 50 -- Basic anti-spam threshold
        )
    );

-- Also allow creators to update their own missions (e.g. archive them)
DROP POLICY IF EXISTS "Mission Edit Own" ON public.missions;
CREATE POLICY "Mission Edit Own" ON public.missions
    FOR UPDATE
    USING (creator_id = auth.uid());

-- 2.3 News Posting
-- Problem: Users cannot post news.
-- Fix: Allow INSERT for users with Developer Status OR High Reputation (>100)
DROP POLICY IF EXISTS "News Create" ON public.news_articles;
CREATE POLICY "News Create" ON public.news_articles
    FOR INSERT
    WITH CHECK (
        auth.role() = 'authenticated' AND (
            EXISTS (
                SELECT 1 FROM public.profiles 
                WHERE id = auth.uid() 
                AND developer_status IN ('APPROVED', 'PENDING')
            )
            OR
            EXISTS (
                SELECT 1 FROM public.wallets 
                WHERE user_id = auth.uid() 
                AND reputation_balance >= 100
            )
        )
    );

-- Allow authors to edit/delete their own news (if author field matches username/id?)
-- Note: 'author' column in news_articles is TEXT (display name), not UUID. 
-- This makes RLS hard. We should probably rely on 'developer_status' for edits 
-- or assume admin oversight. For now, we only enable Creation.

-- 2.4 Ticket Transaction Visibility for Creators
-- Creators might want to see trading history of their tickets
DROP POLICY IF EXISTS "Creator View Transactions" ON public.ticket_transactions;
CREATE POLICY "Creator View Transactions" ON public.ticket_transactions
    FOR SELECT
    USING (
        ticket_type_id IN (
            SELECT id FROM public.ticket_types WHERE creator_id = auth.uid()
        )
    );

RAISE NOTICE 'Permissions and Schema Fixed';
