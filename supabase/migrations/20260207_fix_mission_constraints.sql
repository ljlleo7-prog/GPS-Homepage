-- Fix constraints on missions table to allow new types and statuses
-- This resolves the "violates check constraint 'missions_type_check'" error

-- 1. Update Type Constraint
ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS missions_type_check;

-- Allowed types:
-- Legacy: 'FEEDBACK', 'PLAYTEST', 'IDEA'
-- New: 'MISSION' (used by Missions.tsx direct insert), 'COMMUNITY' (used by create_user_campaign RPC)
ALTER TABLE public.missions ADD CONSTRAINT missions_type_check 
    CHECK (type IN ('FEEDBACK', 'PLAYTEST', 'IDEA', 'MISSION', 'COMMUNITY'));

-- 2. Update Status Constraint
ALTER TABLE public.missions DROP CONSTRAINT IF EXISTS missions_status_check;

-- Allowed statuses:
-- Legacy: 'ACTIVE', 'ARCHIVED'
-- New: 'PENDING', 'PENDING_APPROVAL' (used by RPC), 'APPROVED', 'REJECTED'
ALTER TABLE public.missions ADD CONSTRAINT missions_status_check 
    CHECK (status IN ('ACTIVE', 'ARCHIVED', 'PENDING', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'));

-- 3. Update RLS Policy for Updating Missions
-- Enforce "Cannot edit mission with pending submissions" at the database level
-- This replaces/refines the "Creators can update own missions" policy

DROP POLICY IF EXISTS "Creators can update own missions" ON public.missions;

CREATE POLICY "Creators can update own missions" ON public.missions 
FOR UPDATE 
USING (
    auth.uid() = creator_id AND 
    NOT EXISTS (
        SELECT 1 FROM public.mission_submissions 
        WHERE mission_id = public.missions.id
    )
)
WITH CHECK (auth.uid() = creator_id);
