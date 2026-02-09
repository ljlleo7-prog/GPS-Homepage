-- ==============================================================================
-- UPDATE LEGACY INSTRUMENTS & IMPROVE DELIVERABLE GENERATION
-- Description:
-- 1. Updates original 3 instruments with new deliverable parameters.
-- 2. Renames "2026 Season Launch" to "New Version Launch".
-- 3. Improves maintain_deliverables() to handle MONTHLY/WEEKLY logic correctly.
-- 4. Triggers deliverable generation.
-- ==============================================================================

-- 1. UPDATE LEGACY INSTRUMENTS

-- Low-Risk Stability Bond: Monthly (1st), 0.05, Default Issued
UPDATE public.support_instruments
SET 
    deliverable_frequency = 'MONTHLY',
    deliverable_day = '1',
    deliverable_cost_per_ticket = 0.05,
    deliverable_condition = 'Default issued unless the development team bankrupted or deltadash program is canceled'
WHERE title ILIKE '%Stability Bond%' AND type = 'MILESTONE';

-- Mid-Risk Core Development Index: Weekly (Sunday), 0.05, Progress Based
UPDATE public.support_instruments
SET 
    deliverable_frequency = 'WEEKLY',
    deliverable_day = '0', -- Sunday
    deliverable_cost_per_ticket = 0.05,
    deliverable_condition = 'Issued if development group have any progress (on any project or even website building) or reports from test players'
WHERE title ILIKE '%Core Development Index%' AND type = 'MILESTONE';

-- High-Risk 2026 Season Launch: Rename, Monthly (1st default), 0.5, Version Update
UPDATE public.support_instruments
SET 
    title = 'New Version Launch',
    deliverable_frequency = 'MONTHLY',
    deliverable_day = '1',
    deliverable_cost_per_ticket = 0.5,
    deliverable_condition = 'Issued only if there is a version update in this month'
WHERE title ILIKE '%2026 Season Launch%' AND type = 'MILESTONE';


-- 2. IMPROVE MAINTAIN_DELIVERABLES FUNCTION
CREATE OR REPLACE FUNCTION public.maintain_deliverables()
RETURNS void AS $$
DECLARE
    r RECORD;
    v_next_due TIMESTAMPTZ;
    v_target_day INTEGER;
    v_current_dow INTEGER;
    v_days_until INTEGER;
    v_target_date DATE;
BEGIN
    -- Loop through active instruments (Normal type)
    FOR r IN SELECT * FROM public.support_instruments 
             WHERE type = 'MILESTONE' 
             AND status = 'OPEN' 
             AND is_driver_bet IS FALSE
             AND deliverable_frequency IS NOT NULL
    LOOP
        -- If no pending deliverable exists, check if we should create one
        IF NOT EXISTS (
            SELECT 1 FROM public.instrument_deliverables 
            WHERE instrument_id = r.id AND status = 'PENDING'
        ) THEN
            v_next_due := NULL;
            
            -- Parse deliverable_day safely
            BEGIN
                v_target_day := CAST(NULLIF(r.deliverable_day, '') AS INTEGER);
            EXCEPTION WHEN OTHERS THEN
                v_target_day := 1; 
            END;

            IF r.deliverable_frequency = 'MONTHLY' THEN
                IF v_target_day IS NULL THEN v_target_day := 1; END IF;
                
                -- Calculate target date for CURRENT month
                -- Start from 1st of current month, add (target_day - 1) days
                v_target_date := date_trunc('month', NOW())::DATE + (v_target_day - 1);
                
                -- If this date has already passed, move to NEXT month
                IF v_target_date <= CURRENT_DATE THEN
                    v_target_date := date_trunc('month', NOW() + INTERVAL '1 month')::DATE + (v_target_day - 1);
                END IF;
                
                -- Set due time to Noon (12:00) to avoid timezone edge cases
                v_next_due := v_target_date::TIMESTAMPTZ + INTERVAL '12 hours';

            ELSIF r.deliverable_frequency = 'WEEKLY' THEN
                IF v_target_day IS NULL THEN v_target_day := 0; END IF; -- Default Sunday (0)
                v_current_dow := EXTRACT(DOW FROM NOW());
                
                -- Calculate days until next target day
                v_days_until := (v_target_day - v_current_dow + 7) % 7;
                
                -- If today is the target day, schedule for NEXT week (7 days later) 
                -- to ensure a full period or at least strictly future due date
                IF v_days_until = 0 THEN
                    v_days_until := 7;
                END IF;
                
                v_next_due := NOW() + (v_days_until || ' days')::INTERVAL;
                v_next_due := date_trunc('day', v_next_due) + INTERVAL '12 hours'; 
            END IF;

            -- Create the deliverable if a due date was calculated
            IF v_next_due IS NOT NULL THEN
                INSERT INTO public.instrument_deliverables (instrument_id, due_date)
                VALUES (r.id, v_next_due);
            END IF;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. TRIGGER GENERATION
SELECT public.maintain_deliverables();
