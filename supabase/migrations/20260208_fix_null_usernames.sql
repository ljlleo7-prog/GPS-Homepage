-- Fix NULL usernames in profiles table
-- This ensures all users have a displayable username, especially for Developer Inbox

-- 1. Backfill existing NULL usernames
UPDATE public.profiles
SET username = 'Awaiting_' || substr(id::text, 1, 8)
WHERE username IS NULL;

-- 2. Update get_developer_inbox to be robust against NULL usernames (defensive)
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
  SELECT (developer_status = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_user_id;

  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  -- 1. Pending Developer Requests
  SELECT jsonb_agg(t) INTO v_pending_devs
  FROM (
    SELECT 
        id, 
        COALESCE(username, 'Awaiting_' || substr(id::text, 1, 8)) as username, 
        full_name, 
        created_at
    FROM public.profiles
    WHERE developer_status = 'PENDING'
  ) t;

  -- 2. Pending Mission Submissions
  SELECT jsonb_agg(t) INTO v_pending_missions
  FROM (
    SELECT 
      s.id, 
      s.content, 
      s.created_at, 
      m.title as mission_title,
      COALESCE(p.username, 'Unknown User') as submitter_name,
      s.user_id
    FROM public.mission_submissions s
    JOIN public.missions m ON s.mission_id = m.id
    JOIN public.profiles p ON s.user_id = p.id
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
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forum_posts' AND column_name = 'is_acknowledgement_requested') THEN
      SELECT jsonb_agg(t) INTO v_pending_acks
      FROM (
        SELECT 
          f.id, 
          f.title, 
          f.created_at, 
          COALESCE(p.username, 'Unknown User') as author_name
        FROM public.forum_posts f
        JOIN public.profiles p ON f.author_id = p.id
        WHERE f.is_acknowledgement_requested = true
      ) t;
  ELSE
      v_pending_acks := '[]'::jsonb;
  END IF;

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
          p.email as user_email
      FROM public.test_player_requests r
      JOIN public.profiles p ON r.user_id = p.id
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
END;
$$;
