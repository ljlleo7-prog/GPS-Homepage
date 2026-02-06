-- Test Player System
-- 1. Create table for requests
-- 2. Add tester_programs to profiles
-- 3. RPCs for request/approve/decline
-- 4. Update get_developer_inbox

-- 1. Create Table
CREATE TABLE IF NOT EXISTS public.test_player_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    identifiable_name TEXT NOT NULL,
    program TEXT NOT NULL,
    progress_description TEXT,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add tester_programs to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS tester_programs TEXT[] DEFAULT '{}';

-- 3. RPC: Request Test Player Access
CREATE OR REPLACE FUNCTION public.request_test_player_access(
    p_identifiable_name TEXT,
    p_program TEXT,
    p_progress_description TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  -- Check if already pending for same program
  IF EXISTS (
      SELECT 1 FROM public.test_player_requests 
      WHERE user_id = v_user_id 
      AND program = p_program 
      AND status = 'PENDING'
  ) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Request already pending for this program');
  END IF;

  -- Check if already approved (in profile)
  IF EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = v_user_id 
      AND p_program = ANY(tester_programs)
  ) THEN
      RETURN jsonb_build_object('success', false, 'message', 'Already a tester for this program');
  END IF;

  INSERT INTO public.test_player_requests (
      user_id, identifiable_name, program, progress_description
  ) VALUES (
      v_user_id, p_identifiable_name, p_program, p_progress_description
  );

  RETURN jsonb_build_object('success', true, 'message', 'Request submitted');
END;
$$;

-- 4. RPC: Approve Test Player Request
CREATE OR REPLACE FUNCTION public.approve_test_player_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id UUID;
  v_is_dev BOOLEAN;
  v_req RECORD;
  v_wallet_id UUID;
BEGIN
  v_admin_id := auth.uid();
  
  -- Check permission
  SELECT (developer_status = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_admin_id;

  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  -- Get Request
  SELECT * INTO v_req FROM public.test_player_requests WHERE id = p_request_id;
  
  IF v_req IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Request not found');
  END IF;

  IF v_req.status != 'PENDING' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Request not pending');
  END IF;

  -- Update Profile (Add Program)
  UPDATE public.profiles
  SET tester_programs = array_append(tester_programs, v_req.program)
  WHERE id = v_req.user_id
  AND NOT (v_req.program = ANY(tester_programs)); -- Prevent duplicates

  -- Update Wallet (+20 Rep)
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_req.user_id;
  
  IF v_wallet_id IS NOT NULL THEN
      UPDATE public.wallets
      SET reputation_balance = reputation_balance + 20,
          updated_at = NOW()
      WHERE id = v_wallet_id;

      INSERT INTO public.ledger_entries (
          wallet_id, amount, currency, operation_type, description
      ) VALUES (
          v_wallet_id, 20, 'REP', 'REWARD', 'Test Player Approval Bonus (' || v_req.program || ')'
      );
  END IF;

  -- Update Request Status
  UPDATE public.test_player_requests
  SET status = 'APPROVED', updated_at = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'message', 'Approved successfully');
END;
$$;

-- 5. RPC: Decline Test Player Request
CREATE OR REPLACE FUNCTION public.decline_test_player_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id UUID;
  v_is_dev BOOLEAN;
BEGIN
  v_admin_id := auth.uid();
  
  -- Check permission
  SELECT (developer_status = 'APPROVED') INTO v_is_dev
  FROM public.profiles
  WHERE id = v_admin_id;

  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  UPDATE public.test_player_requests
  SET status = 'REJECTED', updated_at = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'message', 'Declined successfully');
END;
$$;

-- 6. Update Get Developer Inbox
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
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'forum_posts' AND column_name = 'is_acknowledgement_requested') THEN
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
          p.username as user_name,
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
