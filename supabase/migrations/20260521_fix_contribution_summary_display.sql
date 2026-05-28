-- Fix contribution summaries for wallet and developer validation
-- Wallet total now matches visible score-event history; developer top events are grouped by type.

CREATE OR REPLACE FUNCTION public.get_my_contribution_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_summary JSONB;
  v_total_points INTEGER := 0;
  v_resolved_points INTEGER := 0;
  v_pending_points INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'event_type', event_type,
      'times', times,
      'total_points', total_points
    ) ORDER BY total_points DESC, times DESC, event_type ASC
  ) INTO v_summary
  FROM (
    SELECT
      event_type,
      COUNT(*)::int AS times,
      COALESCE(SUM(points), 0)::int AS total_points
    FROM public.community_contribution_score_events
    WHERE user_id = v_user_id
    GROUP BY event_type
  ) grouped;

  SELECT COALESCE(SUM(points), 0)::int INTO v_total_points
  FROM public.community_contribution_score_events
  WHERE user_id = v_user_id;

  SELECT COALESCE(SUM(total_points), 0)::int INTO v_resolved_points
  FROM public.community_contribution_scores
  WHERE user_id = v_user_id AND status = 'RESOLVED';

  SELECT COALESCE(SUM(total_points), 0)::int INTO v_pending_points
  FROM public.community_contribution_scores
  WHERE user_id = v_user_id AND status = 'PENDING';

  RETURN jsonb_build_object(
    'success', true,
    'total_points', v_total_points,
    'resolved_points', v_resolved_points,
    'pending_points', v_pending_points,
    'breakdown', COALESCE(v_summary, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_developer_contribution_validation(p_period_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_period_id UUID := p_period_id;
  v_period RECORD;
  v_scores JSONB;
BEGIN
  IF NOT public.is_approved_developer(v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id
    FROM public.community_contribution_periods
    ORDER BY period_start DESC
    LIMIT 1;

    IF v_period_id IS NULL THEN
      v_period_id := public.get_or_create_current_contribution_period();
    END IF;
  END IF;

  SELECT * INTO v_period FROM public.community_contribution_periods WHERE id = v_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Contribution period not found');
  END IF;

  PERFORM public.calculate_weekly_contribution_scores(v_period_id);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'user_id', s.user_id,
      'username', COALESCE(p.username, 'Unknown'),
      'base_points', COALESCE(ev.base_points, 0),
      'like_points', COALESCE(ev.forum_points, 0),
      'poll_points', COALESCE(ev.poll_points, 0),
      'market_points', COALESCE(ev.market_points, 0),
      'minigame_points', COALESCE(ev.minigame_points, 0),
      'total_points', COALESCE(ev.total_points, s.total_points, 0),
      'status', s.status,
      'suspension_reason', s.suspension_reason,
      'top_events', COALESCE(ev.top_events, '[]'::jsonb)
    ) ORDER BY COALESCE(ev.total_points, s.total_points, 0) DESC, s.updated_at DESC
  ) INTO v_scores
  FROM public.community_contribution_scores s
  LEFT JOIN public.profiles p ON p.id = s.user_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(se.points) FILTER (WHERE se.event_type NOT IN ('forum_post', 'forum_comment', 'poll_vote', 'market_action', 'minigame', 'daily_bonus')), 0)::int AS base_points,
      COALESCE(SUM(se.points) FILTER (WHERE se.event_type IN ('forum_post', 'forum_comment')), 0)::int AS forum_points,
      COALESCE(SUM(se.points) FILTER (WHERE se.event_type = 'poll_vote'), 0)::int AS poll_points,
      COALESCE(SUM(se.points) FILTER (WHERE se.event_type = 'market_action'), 0)::int AS market_points,
      COALESCE(SUM(se.points) FILTER (WHERE se.event_type IN ('minigame', 'daily_bonus')), 0)::int AS minigame_points,
      COALESCE(SUM(se.points), 0)::int AS total_points,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'event_type', grouped.event_type,
            'source_type', grouped.source_type,
            'source_id', NULL,
            'times', grouped.times,
            'points', grouped.total_points,
            'metadata', jsonb_build_object('times', grouped.times, 'total_points', grouped.total_points)
          ) ORDER BY grouped.total_points DESC, grouped.times DESC, grouped.event_type ASC
        )
        FROM (
          SELECT
            se2.event_type,
            MIN(se2.source_type) AS source_type,
            COUNT(*)::int AS times,
            COALESCE(SUM(se2.points), 0)::int AS total_points
          FROM public.community_contribution_score_events se2
          WHERE se2.period_id = s.period_id AND se2.user_id = s.user_id
          GROUP BY se2.event_type
          ORDER BY total_points DESC, times DESC, event_type ASC
          LIMIT 8
        ) grouped
      ) AS top_events
    FROM public.community_contribution_score_events se
    WHERE se.period_id = s.period_id AND se.user_id = s.user_id
  ) ev ON true
  WHERE s.period_id = v_period_id;

  RETURN jsonb_build_object(
    'success', true,
    'period', jsonb_build_object(
      'id', v_period.id,
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'status', v_period.status,
      'auto_resolves_at', v_period.auto_resolves_at,
      'resolved_at', v_period.resolved_at
    ),
    'scores', COALESCE(v_scores, '[]'::jsonb)
  );
END;
$$;

SELECT public.calculate_weekly_contribution_scores();
