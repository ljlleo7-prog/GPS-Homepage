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
-- Called from get_developer_inbox to ensure all interest schedules are materialized.
CREATE OR REPLACE FUNCTION public.maintain_deliverables()
RETURNS void AS $$
DECLARE
    r RECORD;
    v_now TIMESTAMPTZ;
    v_today DATE;
    v_next_due TIMESTAMPTZ;
    v_dow_current INTEGER;
    v_dow_target INTEGER;
    v_days_ahead INTEGER;
    v_day_int INTEGER;
    v_month_int INTEGER;
    v_year_int INTEGER;
    v_day_text TEXT;
    v_parts TEXT[];
    v_existing_due TIMESTAMPTZ;
    v_existing_id UUID;
BEGIN
    v_now := NOW();
    v_today := v_now::date;
    v_dow_current := EXTRACT(DOW FROM v_now)::INT;

    DELETE FROM public.instrument_deliverables d
    USING (
        SELECT id
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY instrument_id ORDER BY due_date ASC) AS rn
            FROM public.instrument_deliverables
            WHERE status = 'PENDING'
              AND due_date > v_now
        ) x
        WHERE rn > 1
    ) dup
    WHERE d.id = dup.id;

    FOR r IN 
        SELECT * 
        FROM public.support_instruments 
        WHERE status != 'RESOLVED'
          AND COALESCE(is_driver_bet, false) = false
          AND deliverable_frequency IS NOT NULL
    LOOP
        SELECT id, due_date
        INTO v_existing_id, v_existing_due
        FROM public.instrument_deliverables 
        WHERE instrument_id = r.id 
          AND status = 'PENDING'
          AND due_date >= v_now
        ORDER BY due_date ASC
        LIMIT 1;

        IF FOUND THEN
            CONTINUE;
        END IF;

        v_next_due := NULL;

        IF r.deliverable_frequency = 'DAILY' THEN
            v_next_due := (v_today + INTERVAL '1 day');

        ELSIF r.deliverable_frequency = 'WEEKLY' THEN
            v_day_text := UPPER(TRIM(r.deliverable_day));
            v_dow_target := NULL;

            IF v_day_text IN ('MON', 'MONDAY') THEN
                v_dow_target := 1;
            ELSIF v_day_text IN ('TUE', 'TUESDAY') THEN
                v_dow_target := 2;
            ELSIF v_day_text IN ('WED', 'WEDNESDAY') THEN
                v_dow_target := 3;
            ELSIF v_day_text IN ('THU', 'THURSDAY') THEN
                v_dow_target := 4;
            ELSIF v_day_text IN ('FRI', 'FRIDAY') THEN
                v_dow_target := 5;
            ELSIF v_day_text IN ('SAT', 'SATURDAY') THEN
                v_dow_target := 6;
            ELSIF v_day_text IN ('SUN', 'SUNDAY') THEN
                v_dow_target := 0;
            END IF;

            IF v_dow_target IS NULL THEN
                CONTINUE;
            END IF;

            v_days_ahead := (v_dow_target - v_dow_current + 7) % 7;
            IF v_days_ahead <= 0 THEN
                v_days_ahead := 7;
            END IF;

            v_next_due := v_today::timestamptz + v_days_ahead * INTERVAL '1 day';

        ELSIF r.deliverable_frequency = 'MONTHLY' THEN
            BEGIN
                v_day_int := NULLIF(regexp_replace(COALESCE(r.deliverable_day, ''), '\D', '', 'g'), '')::INT;
            EXCEPTION WHEN OTHERS THEN
                v_day_int := NULL;
            END;

            IF v_day_int IS NULL OR v_day_int < 1 OR v_day_int > 31 THEN
                CONTINUE;
            END IF;

            v_year_int := EXTRACT(YEAR FROM v_today)::INT;
            v_month_int := EXTRACT(MONTH FROM v_today)::INT;

            v_next_due := make_timestamp(
                v_year_int,
                v_month_int,
                LEAST(
                    v_day_int,
                    EXTRACT(DAY FROM (date_trunc('month', make_date(v_year_int, v_month_int, 1)) + INTERVAL '1 month - 1 day'))::INT
                ),
                0, 0, 0
            );

            IF v_next_due <= v_now THEN
                v_month_int := v_month_int + 1;
                IF v_month_int > 12 THEN
                    v_month_int := 1;
                    v_year_int := v_year_int + 1;
                END IF;

                v_next_due := make_timestamp(
                    v_year_int,
                    v_month_int,
                    LEAST(
                        v_day_int,
                        EXTRACT(DAY FROM (date_trunc('month', make_date(v_year_int, v_month_int, 1)) + INTERVAL '1 month - 1 day'))::INT
                    ),
                    0, 0, 0
                );
            END IF;

        ELSIF r.deliverable_frequency = 'QUARTERLY' THEN
            v_next_due := (v_today + INTERVAL '3 months');

        ELSIF r.deliverable_frequency = 'YEARLY' THEN
            v_parts := string_to_array(COALESCE(r.deliverable_day, ''), '-');
            IF array_length(v_parts, 1) = 2 THEN
                BEGIN
                    v_month_int := v_parts[1]::INT;
                    v_day_int := v_parts[2]::INT;
                EXCEPTION WHEN OTHERS THEN
                    v_month_int := NULL;
                    v_day_int := NULL;
                END;

                IF v_month_int IS NULL OR v_day_int IS NULL OR v_month_int < 1 OR v_month_int > 12 OR v_day_int < 1 OR v_day_int > 31 THEN
                    CONTINUE;
                END IF;

                v_year_int := EXTRACT(YEAR FROM v_today)::INT;

                v_next_due := make_timestamp(
                    v_year_int,
                    v_month_int,
                    LEAST(
                        v_day_int,
                        EXTRACT(DAY FROM (date_trunc('month', make_date(v_year_int, v_month_int, 1)) + INTERVAL '1 month - 1 day'))::INT
                    ),
                    0, 0, 0
                );

                IF v_next_due <= v_now THEN
                    v_year_int := v_year_int + 1;
                    v_next_due := make_timestamp(
                        v_year_int,
                        v_month_int,
                        LEAST(
                            v_day_int,
                            EXTRACT(DAY FROM (date_trunc('month', make_date(v_year_int, v_month_int, 1)) + INTERVAL '1 month - 1 day'))::INT
                        ),
                        0, 0, 0
                    );
                END IF;
            ELSE
                CONTINUE;
            END IF;
        END IF;

        IF v_next_due IS NOT NULL THEN
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
