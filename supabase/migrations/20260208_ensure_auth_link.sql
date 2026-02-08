-- ENSURE PROFILES LINKED TO AUTH
-- This migration fixes the root cause: The profiles table might exist but be disconnected from auth.users.

-- 1. CLEANUP ORPHANS (Prerequisite for FK)
-- Delete profiles that have no corresponding user in auth.users
-- This is critical because you cannot add a foreign key constraint if invalid data exists.
DELETE FROM public.profiles 
WHERE id NOT IN (SELECT id FROM auth.users);

-- 2. FORCE FOREIGN KEY CONSTRAINT
DO $$
BEGIN
    -- Drop if exists (to ensure we have the correct properties like CASCADE)
    BEGIN 
        ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey; 
    EXCEPTION WHEN OTHERS THEN NULL; 
    END;

    -- Add the constraint
    -- This ensures that 'profiles' is strictly an extension of 'auth.users'
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id)
    REFERENCES auth.users(id)
    ON DELETE CASCADE;
END $$;

-- 3. ENSURE TRIGGER EXISTS
-- Re-create the trigger to ensure new sign-ups automatically get a profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 4. BACKFILL MISSING PROFILES (Just in case)
-- If any users exist in Auth but not in Profiles, create them now.
INSERT INTO public.profiles (id, username, full_name, avatar_url, last_login, created_at, updated_at)
SELECT 
    id, 
    -- Ensure unique username fallback
    COALESCE(raw_user_meta_data->>'username', 'User_' || substr(id::text, 1, 8)),
    COALESCE(raw_user_meta_data->>'full_name', ''),
    COALESCE(raw_user_meta_data->>'avatar_url', ''),
    NOW(),
    created_at,
    NOW()
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles);

-- 5. ENSURE WALLETS EXIST (For backfilled profiles)
INSERT INTO public.wallets (id, user_id, token_balance, reputation_balance)
SELECT gen_random_uuid(), id, 100, 0
FROM public.profiles
WHERE id NOT IN (SELECT user_id FROM public.wallets);
