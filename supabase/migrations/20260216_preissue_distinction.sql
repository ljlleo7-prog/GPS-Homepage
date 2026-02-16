-- ==============================================================================
-- PRE-ISSUE DISTINCTION & STATUS CONSOLIDATION
-- 1) Allow PRE_ISSUED in instrument_deliverables.status
-- 2) Revert existing ISSUED rows to PRE_ISSUED
-- ==============================================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'public.instrument_deliverables'::regclass
          AND contype = 'c'
    LOOP
        EXECUTE 'ALTER TABLE public.instrument_deliverables DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

ALTER TABLE public.instrument_deliverables
    ADD CONSTRAINT instrument_deliverables_status_check
    CHECK (status IN (
        'PENDING',
        'PRE_ISSUED',
        'ISSUED',
        'REJECTED',
        'MISSED',
        'MISSED_PENALTY',
        'SKIPPED'
    ));

UPDATE public.instrument_deliverables
SET status = 'PRE_ISSUED',
    updated_at = NOW()
WHERE status = 'ISSUED';
