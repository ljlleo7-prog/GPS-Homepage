-- ==============================================================================
-- DELIVERABLE SYSTEM & FORUM/RLS FIXES
-- Description:
-- 1. Creates instrument_deliverables table.
-- 2. Implements logic to generate and process deliverables.
-- 3. Fixes Forum RLS (ensure public visibility).
-- 4. Restores Support Instruments RLS.
-- ==============================================================================

-- 1. INSTRUMENT DELIVERABLES TABLE
CREATE TABLE IF NOT EXISTS public.instrument_deliverables (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    instrument_id UUID REFERENCES public.support_instruments(id) ON DELETE CASCADE,
    due_date TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ISSUED', 'REJECTED', 'MISSED_PENALTY')),
    payout_amount NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for Deliverables
ALTER TABLE public.instrument_deliverables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deliverables viewable by everyone" ON public.instrument_deliverables;
CREATE POLICY "Deliverables viewable by everyone" ON public.instrument_deliverables FOR SELECT USING (true);

DROP POLICY IF EXISTS "Developers can update deliverables" ON public.instrument_deliverables;
CREATE POLICY "Developers can update deliverables" ON public.instrument_deliverables 
    FOR UPDATE 
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND developer_status = 'APPROVED'));

-- 2. FUNCTION TO GENERATE DELIVERABLES
-- Should be called periodically or via trigger. For now, we can call it when viewing the inbox.
CREATE OR REPLACE FUNCTION public.maintain_deliverables()
RETURNS void AS $$
DECLARE
    r RECORD;
    v_next_due TIMESTAMPTZ;
BEGIN
    -- Loop through active instruments (Normal type)
    FOR r IN SELECT * FROM public.support_instruments 
             WHERE type = 'MILESTONE' 
             AND status = 'OPEN' 
             AND is_driver_bet IS FALSE -- Only Normal Instruments
             AND deliverable_frequency IS NOT NULL
    LOOP
        -- Logic to determine next due date
        -- Simplified: If no pending deliverable exists, create one based on frequency
        IF NOT EXISTS (
            SELECT 1 FROM public.instrument_deliverables 
            WHERE instrument_id = r.id AND status = 'PENDING'
        ) THEN
            -- Calculate next due date (Simplified for now: Next 'Day' of Month/Week)
            -- This is complex date math. For MVP, let's say due in 7 days or next 1st of month.
            -- Using a placeholder logic:
            v_next_due := NOW() + INTERVAL '7 days'; 
            
            INSERT INTO public.instrument_deliverables (instrument_id, due_date)
            VALUES (r.id, v_next_due);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. FIX FORUM RLS (Ensure Visibility)
DROP POLICY IF EXISTS "Forum Posts View All" ON public.forum_posts;
CREATE POLICY "Forum Posts View All" ON public.forum_posts FOR SELECT USING (true);

-- 4. FIX SUPPORT INSTRUMENTS RLS & VISIBILITY
DROP POLICY IF EXISTS "Instruments View All" ON public.support_instruments;
CREATE POLICY "Instruments View All" ON public.support_instruments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create instruments" ON public.support_instruments;
CREATE POLICY "Users can create instruments" ON public.support_instruments 
    FOR INSERT 
    WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Creators can update own instruments" ON public.support_instruments;
CREATE POLICY "Creators can update own instruments" ON public.support_instruments 
    FOR UPDATE 
    USING (auth.uid() = creator_id);

-- 5. RECLAIM BETS (Fix ownership if needed, or just ensure visibility)
-- If users can't see their bets, it's likely the RLS or the 'is_driver_bet' flag.
-- We already fixed the flag in previous migration.
-- We ensure RLS is open above.

-- 6. DEVELOPER PENALTY LOGIC (Skeleton)
CREATE OR REPLACE FUNCTION public.process_overdue_deliverables()
RETURNS void AS $$
DECLARE
    r RECORD;
    v_dev_count INTEGER;
    v_penalty_per_dev NUMERIC;
    v_total_payout NUMERIC;
BEGIN
    FOR r IN SELECT * FROM public.instrument_deliverables 
             WHERE status = 'PENDING' AND due_date < NOW()
    LOOP
        -- 1. Calculate Payout
        -- Need to know total supply and cost per ticket
        -- v_total_payout := ...
        
        -- 2. Charge Developers
        -- ...
        
        -- 3. Mark as MISSED_PENALTY
        UPDATE public.instrument_deliverables 
        SET status = 'MISSED_PENALTY', updated_at = NOW() 
        WHERE id = r.id;
        
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

