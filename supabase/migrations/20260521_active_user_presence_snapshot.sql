-- Track passive user presence and expose adjustable active-user snapshot windows

CREATE OR REPLACE FUNCTION public.update_my_presence()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  UPDATE public.profiles
  SET last_login = NOW(), updated_at = NOW()
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'last_login', NOW());
END;
$$;

CREATE OR REPLACE FUNCTION public.get_weekly_community_snapshot(p_days INT DEFAULT 7)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INT := LEAST(GREATEST(COALESCE(p_days, 7), 1), 90);
  v_since TIMESTAMPTZ := NOW() - make_interval(days => v_days);
  v_period_id UUID;
  v_active_participants INT;
  v_event_participants INT;
  v_events INT;
  v_poll_votes INT;
  v_forum_posts INT;
  v_forum_comments INT;
  v_pending_scores INT;
  v_suspended_scores INT;
  v_resolved_scores INT;
BEGIN
  SELECT id INTO v_period_id
  FROM public.community_contribution_periods
  WHERE period_start <= CURRENT_DATE AND period_end > CURRENT_DATE
  ORDER BY period_start DESC
  LIMIT 1;

  SELECT COUNT(*)::int INTO v_active_participants
  FROM public.profiles
  WHERE last_login >= v_since;

  SELECT COUNT(DISTINCT user_id)::int, COUNT(*)::int
  INTO v_event_participants, v_events
  FROM public.community_engagement_events
  WHERE created_at >= v_since;

  SELECT COUNT(*)::int INTO v_poll_votes
  FROM public.community_poll_votes
  WHERE created_at >= v_since;

  SELECT COUNT(*)::int INTO v_forum_posts
  FROM public.forum_posts
  WHERE created_at >= v_since;

  SELECT COUNT(*)::int INTO v_forum_comments
  FROM public.forum_comments
  WHERE created_at >= v_since;

  IF v_period_id IS NOT NULL THEN
    SELECT
      COUNT(*) FILTER (WHERE status = 'PENDING')::int,
      COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int,
      COUNT(*) FILTER (WHERE status = 'RESOLVED')::int
    INTO v_pending_scores, v_suspended_scores, v_resolved_scores
    FROM public.community_contribution_scores
    WHERE period_id = v_period_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'days', v_days,
    'active_participants', COALESCE(v_active_participants, 0),
    'event_participants', COALESCE(v_event_participants, 0),
    'events', COALESCE(v_events, 0),
    'poll_votes', COALESCE(v_poll_votes, 0),
    'forum_posts', COALESCE(v_forum_posts, 0),
    'forum_comments', COALESCE(v_forum_comments, 0),
    'pending_scores', COALESCE(v_pending_scores, 0),
    'suspended_scores', COALESCE(v_suspended_scores, 0),
    'resolved_scores', COALESCE(v_resolved_scores, 0)
  );
END;
$$;
