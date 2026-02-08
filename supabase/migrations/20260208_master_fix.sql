-- MASTER FIX SCRIPT
-- 1. Ensure Profiles Table & Columns
-- 2. Ensure RLS Policies (Public Read)
-- 3. Restore Missing Profiles (from auth.users)
-- 4. Fix NULL Usernames
-- 5. Fix Developer Inbox RPC

-- ==========================================
-- 1. SCHEMA & COLUMNS
-- ==========================================
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

-- Ensure columns exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'developer_status') THEN
        ALTER TABLE public.profiles ADD COLUMN developer_status TEXT DEFAULT 'NONE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'full_name') THEN
        ALTER TABLE public.profiles ADD COLUMN full_name TEXT;
    END IF;
END $$;

-- ==========================================
-- 2. RLS POLICIES
-- ==========================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists to avoid conflicts (safe way)
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- Create Public Read Policy
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT USING (true);

-- Users can update own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- ==========================================
-- 3. RESTORE MISSING PROFILES
-- ==========================================
-- Insert profiles for users who exist in auth.users but not in public.profiles
INSERT INTO public.profiles (id, username, created_at, updated_at, last_login, developer_status)
SELECT 
    id, 
    -- Generate unique username to avoid conflicts
    'User_' || substr(id::text, 1, 8),
    created_at, 
    NOW(),
    NOW(),
    'NONE'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles);

-- ==========================================
-- 4. FIX NULL USERNAMES
-- ==========================================
-- Ensure no profile has NULL username (which breaks display)
UPDATE public.profiles
SET username = 'User_' || substr(id::text, 1, 8)
WHERE username IS NULL;

-- Fix "Awaiting" duplicates if any (ensure uniqueness)
-- We can't easily fix duplicates in one query without complex logic, 
-- but the INSERT above handles new ones.
-- If there are existing duplicates, Postgres would have thrown error.
-- We'll assume the UNIQUE constraint holds.

-- ==========================================
-- 5. ROBUST INBOX RPC
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_developer_inbox()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_is_dev BOOLEAN;
  v_pending_devs JSONB;
  v_pending_missions JSONB;
  v_active_bets JSONB;
  v_pending_acks JSONB;
  v_pending_tests JSONB;
BEGIN
  v_user_id := auth.uid();
  
  SELECT (COALESCE(developer_status, 'NONE') = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_is_dev IS NULL THEN v_is_dev := false; END IF;

  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  -- 1. Pending Developer Requests
  SELECT jsonb_agg(t) INTO v_pending_devs
  FROM (
    SELECT 
        id, 
        COALESCE(username, 'User_' || substr(id::text, 1, 8)) as username, 
        COALESCE(full_name, 'No Name') as full_name, 
        created_at
    FROM public.profiles
    WHERE developer_status = 'PENDING'
  ) t;

  -- 2. Pending Mission Submissions
  SELECT jsonb_agg(t) INTO v_pending_missions
  FROM (
    SELECT 
      s.id, s.content, s.created_at, 
      COALESCE(m.title, 'Unknown Mission') as mission_title,
      COALESCE(p.username, 'Unknown User') as submitter_name,
      s.user_id
    FROM public.mission_submissions s
    LEFT JOIN public.missions m ON s.mission_id = m.id
    LEFT JOIN public.profiles p ON s.user_id = p.id
    WHERE s.status = 'PENDING'
  ) t;

  -- 3. Active Bets
  SELECT jsonb_agg(t) INTO v_active_bets
  FROM (
    SELECT 
      i.id, i.title, i.description, i.official_end_date, i.side_a_name, i.side_b_name,
      COALESCE(p.username, 'Unknown User') as creator_name
    FROM public.support_instruments i
    LEFT JOIN public.profiles p ON i.creator_id = p.id
    WHERE i.is_driver_bet = true AND i.status != 'RESOLVED'
  ) t;

  -- 4. Forum Acks
  BEGIN
      SELECT jsonb_agg(t) INTO v_pending_acks
      FROM (
        SELECT f.id, f.title, f.created_at, COALESCE(p.username, 'Unknown User') as author_name
        FROM public.forum_posts f
        LEFT JOIN public.profiles p ON f.author_id = p.id
        WHERE f.is_acknowledgement_requested = true
      ) t;
  EXCEPTION WHEN OTHERS THEN v_pending_acks := '[]'::jsonb; END;

  -- 5. Test Requests
  SELECT jsonb_agg(t) INTO v_pending_tests
  FROM (
      SELECT r.id, r.identifiable_name, r.program, r.progress_description, r.created_at,
          COALESCE(p.username, 'Unknown User') as user_name,
          COALESCE(p.email, 'No Email') as user_email
      FROM public.test_player_requests r
      LEFT JOIN public.profiles p ON r.user_id = p.id
      WHERE r.status = 'PENDING'
  ) t;

  RETURN jsonb_build_object(
    'success', true,
    'pending_devs', COALESCE(v_pending_devs, '[]'::jsonb),
    'pending_missions', COALESCE(v_pending_missions, '[]'::jsonb),
    'active_bets', COALESCE(v_active_bets, '[]'::jsonb),
    'pending_acks', COALESCE(v_pending_acks, '[]'::jsonb),
    'pending_tests', COALESCE(v_pending_tests, '[]'::jsonb)
  );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', 'RPC Error: ' || SQLERRM);
END;
$$;
