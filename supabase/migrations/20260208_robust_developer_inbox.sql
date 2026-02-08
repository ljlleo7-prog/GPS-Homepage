-- Robust Developer Inbox Fix
-- 1. Ensure schema integrity (full_name exists)
-- 2. Redefine get_developer_inbox with defensive coding (COALESCE, LEFT JOINs)
-- 3. Handle potential errors gracefully

-- 1. Ensure full_name column exists (Idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'full_name') THEN
        ALTER TABLE public.profiles ADD COLUMN full_name TEXT;
    END IF;
END $$;

-- 2. Fix NULL usernames (Idempotent)
UPDATE public.profiles
SET username = 'Awaiting_' || substr(id::text, 1, 8)
WHERE username IS NULL;

-- 3. Redefine get_developer_inbox
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
  
  -- Check if user is developer (or admin)
  -- Use COALESCE to handle potential NULL developer_status
  SELECT (COALESCE(developer_status, 'NONE') = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_user_id;

  -- Default to false if user not found
  IF v_is_dev IS NULL THEN 
    v_is_dev := false;
  END IF;

  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  -- 1. Pending Developer Requests
  -- Robust: COALESCE fields, handle missing full_name
  SELECT jsonb_agg(t) INTO v_pending_devs
  FROM (
    SELECT 
        id, 
        COALESCE(username, 'Awaiting_' || substr(id::text, 1, 8)) as username, 
        COALESCE(full_name, 'No Name') as full_name, 
        created_at
    FROM public.profiles
    WHERE developer_status = 'PENDING'
  ) t;

  -- 2. Pending Mission Submissions
  -- Robust: LEFT JOIN to ensure submissions show up even if profile/mission deleted (though FKs should prevent)
  SELECT jsonb_agg(t) INTO v_pending_missions
  FROM (
    SELECT 
      s.id, 
      s.content, 
      s.created_at, 
      COALESCE(m.title, 'Unknown Mission') as mission_title,
      COALESCE(p.username, 'Unknown User') as submitter_name,
      s.user_id
    FROM public.mission_submissions s
    LEFT JOIN public.missions m ON s.mission_id = m.id
    LEFT JOIN public.profiles p ON s.user_id = p.id
    WHERE s.status = 'PENDING'
  ) t;

  -- 3. Active Bets (Driver Bets needing resolution)
  SELECT jsonb_agg(t) INTO v_active_bets
  FROM (
    SELECT 
      i.id, 
      i.title, 
      i.description, 
      i.official_end_date, 
      i.side_a_name, 
      i.side_b_name,
      COALESCE(p.username, 'Unknown User') as creator_name
    FROM public.support_instruments i
    LEFT JOIN public.profiles p ON i.creator_id = p.id
    WHERE i.is_driver_bet = true 
    AND i.status != 'RESOLVED'
  ) t;

  -- 4. Forum Acknowledgement Requests
  -- Check column existence dynamically or just assume it exists (migrations should have run)
  -- We'll assume it exists but use a safe query
  BEGIN
      SELECT jsonb_agg(t) INTO v_pending_acks
      FROM (
        SELECT 
          f.id, 
          f.title, 
          f.created_at, 
          COALESCE(p.username, 'Unknown User') as author_name
        FROM public.forum_posts f
        LEFT JOIN public.profiles p ON f.author_id = p.id
        WHERE f.is_acknowledgement_requested = true
      ) t;
  EXCEPTION WHEN OTHERS THEN
      v_pending_acks := '[]'::jsonb; -- Fallback if column missing
  END;

  -- 5. Pending Test Player Requests
  SELECT jsonb_agg(t) INTO v_pending_tests
  FROM (
      SELECT 
          r.id,
          r.identifiable_name,
          r.program,
          r.progress_description,
          r.created_at,
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
    -- Return error safely to help debugging on frontend
    RETURN jsonb_build_object('success', false, 'message', 'RPC Error: ' || SQLERRM);
END;
$$;
