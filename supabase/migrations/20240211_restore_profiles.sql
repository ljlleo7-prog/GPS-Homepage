-- ==========================================
-- RESTORE PROFILES SCRIPT (Wallet Preserved)
-- ==========================================

-- 1. Ensure PROFILES table exists and has correct columns
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  developer_status TEXT DEFAULT 'NONE' CHECK (developer_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED')),
  last_login TIMESTAMPTZ
);

-- Ensure columns exist (idempotent checks)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'developer_status') THEN
        ALTER TABLE public.profiles ADD COLUMN developer_status TEXT DEFAULT 'NONE' CHECK (developer_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED'));
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'last_login') THEN
        ALTER TABLE public.profiles ADD COLUMN last_login TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'updated_at') THEN
        ALTER TABLE public.profiles ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'created_at') THEN
        ALTER TABLE public.profiles ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- 2. Restore Profiles from auth.users
-- We select users from auth.users who do NOT have a profile entry and insert them.
-- CRITICAL CHANGE: username is set to NULL to trigger the frontend popup.
INSERT INTO public.profiles (id, username, created_at, updated_at, last_login, developer_status)
SELECT 
    id, 
    'Awaiting_' || substr(id::text, 1, 8) as username, -- Set to unique 'Awaiting_XYZ' to satisfy unique constraint
    created_at, 
    NOW() as updated_at,
    NOW() as last_login,
    'NONE' as developer_status
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles);

-- 3. Note: Wallets are preserved as requested.
-- No wallet operations are performed here.
