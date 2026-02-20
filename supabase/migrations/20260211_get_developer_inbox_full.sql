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
  v_interest_instruments JSONB;
  v_deliverable_schedule JSONB;
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
  BEGIN
    SELECT jsonb_agg(t) INTO v_interest_instruments FROM (
      SELECT 
        id,
        title,
        deliverable_frequency,
        deliverable_day,
        deliverable_condition
      FROM public.support_instruments
      WHERE status != 'RESOLVED'
        AND COALESCE(is_driver_bet, false) = false
        AND deliverable_frequency IS NOT NULL
    ) t;
  EXCEPTION WHEN OTHERS THEN
    v_interest_instruments := '[]'::jsonb;
  END;
  -- Deliverable schedule including pre-issued/pre-rejected markers
  BEGIN
    SELECT jsonb_agg(t) INTO v_deliverable_schedule FROM (
      SELECT 
        d.id,
        d.instrument_id,
        d.due_date,
        d.status,
        i.title as instrument_title
      FROM public.instrument_deliverables d
      JOIN public.support_instruments i ON d.instrument_id = i.id
      WHERE d.due_date >= NOW()
        AND i.status != 'RESOLVED'
        AND COALESCE(i.is_driver_bet, false) = false
    ) t;
  EXCEPTION WHEN OTHERS THEN
    v_deliverable_schedule := '[]'::jsonb;
  END;
  RETURN jsonb_build_object(
    'success', true,
    'pending_devs', COALESCE(v_pending_devs, '[]'::jsonb),
    'pending_missions', COALESCE(v_pending_missions, '[]'::jsonb),
    'active_bets', COALESCE(v_active_bets, '[]'::jsonb),
    'pending_acks', COALESCE(v_pending_acks, '[]'::jsonb),
    'pending_tests', COALESCE(v_pending_tests, '[]'::jsonb),
    'pending_deliverables', COALESCE(v_pending_deliverables, '[]'::jsonb),
    'interest_instruments', COALESCE(v_interest_instruments, '[]'::jsonb),
    'deliverable_schedule', COALESCE(v_deliverable_schedule, '[]'::jsonb)
  );
END;
$$;

-- Allow seller to withdraw an ACTIVE listing and restore tickets from escrow
CREATE OR REPLACE FUNCTION public.withdraw_ticket_listing(
  p_listing_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_seller_id UUID;
  v_ticket_type_id UUID;
  v_quantity INTEGER;
  v_status TEXT;
BEGIN
  SELECT seller_id, ticket_type_id, quantity, status
  INTO v_seller_id, v_ticket_type_id, v_quantity, v_status
  FROM public.ticket_listings
  WHERE id = p_listing_id;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Listing not found');
  END IF;

  IF v_seller_id != v_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not your listing');
  END IF;

  IF v_status != 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Listing not active');
  END IF;

  UPDATE public.ticket_listings
  SET status = 'CANCELLED'
  WHERE id = p_listing_id;

  INSERT INTO public.user_ticket_balances (user_id, ticket_type_id, balance)
  VALUES (v_seller_id, v_ticket_type_id, v_quantity)
  ON CONFLICT (user_id, ticket_type_id)
  DO UPDATE SET balance = user_ticket_balances.balance + EXCLUDED.balance;

  RETURN jsonb_build_object('success', true);
END;
$$;
-- Cleanup duplicates of ISSUED deliverables to avoid repetitive costs
CREATE OR REPLACE FUNCTION public.cleanup_issued_deliverable_duplicates(
  p_instrument_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_dev BOOLEAN;
  v_deleted_count INTEGER := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = v_user_id AND developer_status = 'APPROVED'
  ) INTO v_is_dev;

  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Access Denied');
  END IF;

  WITH dup AS (
    SELECT id
    FROM (
      SELECT 
        id,
        instrument_id,
        due_date,
        ROW_NUMBER() OVER (PARTITION BY instrument_id, due_date ORDER BY created_at ASC) AS rn
      FROM public.instrument_deliverables
      WHERE status IN ('ISSUED','PRE_ISSUED')
        AND (p_instrument_id IS NULL OR instrument_id = p_instrument_id)
    ) x
    WHERE rn > 1
  )
  DELETE FROM public.instrument_deliverables d
  USING dup
  WHERE d.id = dup.id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'deleted', COALESCE(v_deleted_count, 0));
END;
$$;
