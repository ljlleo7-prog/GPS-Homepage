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
  v_pending_deliverables JSONB;
BEGIN
  v_user_id := auth.uid();
  SELECT (COALESCE(developer_status, 'NONE') = 'APPROVED') INTO v_is_dev FROM public.profiles WHERE id = v_user_id;
  IF v_is_dev IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;
  BEGIN
    PERFORM public.maintain_deliverables();
  EXCEPTION WHEN OTHERS THEN
  END;
  SELECT jsonb_agg(t) INTO v_pending_devs FROM (
    SELECT id, COALESCE(username, 'Awaiting_' || substr(id::text, 8)) as username, COALESCE(full_name, 'No Name') as full_name, created_at
    FROM public.profiles
    WHERE TRIM(UPPER(developer_status)) = 'PENDING'
  ) t;
  SELECT jsonb_agg(t) INTO v_pending_missions FROM (
    SELECT s.id, s.content, s.created_at, COALESCE(m.title, 'Unknown Mission') as mission_title, COALESCE(p.username, 'Unknown User') as submitter_name, s.user_id
    FROM public.mission_submissions s
    LEFT JOIN public.missions m ON s.mission_id = m.id
    LEFT JOIN public.profiles p ON s.user_id = p.id
    WHERE s.status = 'PENDING'
  ) t;
  SELECT jsonb_agg(t) INTO v_active_bets FROM (
    SELECT i.id, i.title, i.description, i.official_end_date, COALESCE(i.open_date, i.created_at) as open_date, i.side_a_name, i.side_b_name, COALESCE(p.username, 'Unknown User') as creator_name
    FROM public.support_instruments i
    LEFT JOIN public.profiles p ON i.creator_id = p.id
    WHERE i.is_driver_bet = true AND i.status != 'RESOLVED'
  ) t;
  BEGIN
    SELECT jsonb_agg(t) INTO v_pending_acks FROM (
      SELECT f.id, f.title, f.created_at, COALESCE(p.username, 'Unknown User') as author_name
      FROM public.forum_posts f
      LEFT JOIN public.profiles p ON f.author_id = p.id
      WHERE f.is_acknowledgement_requested = true
    ) t;
  EXCEPTION WHEN OTHERS THEN
    v_pending_acks := '[]'::jsonb;
  END;
  BEGIN
    SELECT jsonb_agg(t) INTO v_pending_tests FROM (
      SELECT r.id, r.identifiable_name, r.program, r.progress_description, r.created_at, COALESCE(p.username, 'Unknown User') as user_name, COALESCE(u.email, 'No Email') as user_email
      FROM public.test_player_requests r
      LEFT JOIN public.profiles p ON r.user_id = p.id
      LEFT JOIN auth.users u ON r.user_id = u.id
      WHERE r.status = 'PENDING'
    ) t;
  EXCEPTION WHEN OTHERS THEN
    v_pending_tests := '[]'::jsonb;
  END;
  BEGIN
    SELECT jsonb_agg(t) INTO v_pending_deliverables FROM (
      SELECT d.id, d.instrument_id, d.due_date, d.created_at, i.title as instrument_title, i.deliverable_condition, i.deliverable_cost_per_ticket, COALESCE(p.username, 'Unknown User') as creator_name
      FROM public.instrument_deliverables d
      JOIN public.support_instruments i ON d.instrument_id = i.id
      LEFT JOIN public.profiles p ON i.creator_id = p.id
      WHERE d.status = 'PENDING'
    ) t;
  EXCEPTION WHEN OTHERS THEN
    v_pending_deliverables := '[]'::jsonb;
  END;
  RETURN jsonb_build_object(
    'success', true,
    'pending_devs', COALESCE(v_pending_devs, '[]'::jsonb),
    'pending_missions', COALESCE(v_pending_missions, '[]'::jsonb),
    'active_bets', COALESCE(v_active_bets, '[]'::jsonb),
    'pending_acks', COALESCE(v_pending_acks, '[]'::jsonb),
    'pending_tests', COALESCE(v_pending_tests, '[]'::jsonb),
    'pending_deliverables', COALESCE(v_pending_deliverables, '[]'::jsonb)
  );
END;
$$;
