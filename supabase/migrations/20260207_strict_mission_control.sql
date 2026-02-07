
-- Cleanup and Strict Constraints for Missions

-- 1. Delete anonymous missions (or invalid ones)
DELETE FROM public.missions WHERE creator_id IS NULL;

-- 2. Enforce creator_id is NOT NULL
ALTER TABLE public.missions 
ALTER COLUMN creator_id SET NOT NULL;

-- 3. Ensure RLS allows creators to edit/delete their own missions (Double check)
-- This was done in previous migration, but good to ensure.
-- The previous migration 20260207_mission_developer_management.sql added:
-- CREATE POLICY "Creators can update own missions" ...
-- CREATE POLICY "Creators can delete own missions" ...
-- So we are good there.

-- 4. Ensure RLS for Submissions (Only Developers can update status/payouts)
-- Existing policy: "Users can create submissions" (INSERT)
-- Existing policy: "Users can view own submissions" (SELECT)
-- We need to ensure that UPDATE is restricted.
-- By default, if no policy matches, access is denied.
-- Let's check if there's any broad UPDATE policy.
-- "Anyone can view..." is SELECT.
-- If we haven't defined an UPDATE policy for mission_submissions, then NO ONE can update them (except via service_role/RPC).
-- DeveloperInbox uses direct update: supabase.from('mission_submissions').update(...)
-- This means the user (developer) is calling it from the client.
-- We need a policy that allows "Developers" to UPDATE mission_submissions.

CREATE POLICY "Developers can update mission submissions" ON public.mission_submissions
FOR UPDATE
USING (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.developer_status = 'APPROVED'
  )
);
