-- 1. Add request_acknowledgement to forum_posts
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forum_posts' AND column_name = 'is_acknowledgement_requested') THEN
        ALTER TABLE public.forum_posts ADD COLUMN is_acknowledgement_requested BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 2. RPC: Request Developer Access
CREATE OR REPLACE FUNCTION public.request_developer_access()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_current_status TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT developer_status INTO v_current_status
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_current_status = 'APPROVED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Already a developer');
  END IF;

  IF v_current_status = 'PENDING' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Request already pending');
  END IF;

  UPDATE public.profiles
  SET developer_status = 'PENDING'
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'message', 'Request submitted');
END;
$$;

-- 3. RPC: Get Developer Inbox Items
-- Returns a JSON object with lists of pending items
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
    SELECT id, username, full_name, created_at
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
      p.username as submitter_name,
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
      p.username as creator_name
    FROM public.support_instruments i
    LEFT JOIN public.profiles p ON i.creator_id = p.id
    WHERE i.is_driver_bet = true 
    AND i.status != 'RESOLVED'
  ) t;

  -- 4. Forum Acknowledgement Requests
  SELECT jsonb_agg(t) INTO v_pending_acks
  FROM (
    SELECT 
      f.id, 
      f.title, 
      f.created_at, 
      p.username as author_name
    FROM public.forum_posts f
    JOIN public.profiles p ON f.author_id = p.id
    WHERE f.is_acknowledgement_requested = true
  ) t;

  RETURN jsonb_build_object(
    'success', true,
    'pending_devs', COALESCE(v_pending_devs, '[]'::jsonb),
    'pending_missions', COALESCE(v_pending_missions, '[]'::jsonb),
    'active_bets', COALESCE(v_active_bets, '[]'::jsonb),
    'pending_acks', COALESCE(v_pending_acks, '[]'::jsonb)
  );
END;
$$;
