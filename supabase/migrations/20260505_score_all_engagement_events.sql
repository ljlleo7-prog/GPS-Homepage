-- Score ALL engagement events equally, not just specific types
-- This ensures fair scoring for all users regardless of activity type

CREATE OR REPLACE FUNCTION public.calculate_weekly_contribution_scores(p_period_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID := p_period_id;
  v_period RECORD;
  v_calculated INT := 0;
BEGIN
  IF v_period_id IS NULL THEN
    v_period_id := public.get_or_create_current_contribution_period();
  END IF;

  SELECT * INTO v_period FROM public.community_contribution_periods WHERE id = v_period_id;
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Contribution period not found');
  END IF;

  -- Clear existing score events for non-suspended users
  DELETE FROM public.community_contribution_score_events se
  WHERE se.period_id = v_period_id
    AND NOT EXISTS (
      SELECT 1 FROM public.community_contribution_scores s
      WHERE s.period_id = se.period_id
        AND s.user_id = se.user_id
        AND s.status = 'SUSPENDED'
    );

  -- Score ALL engagement events (1 point each, no filtering by type)
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    e.user_id,
    e.event_type,
    e.source_type,
    e.source_id,
    1,
    e.metadata
  FROM public.community_engagement_events e
  LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = e.user_id
  WHERE e.created_at >= v_period.period_start::timestamptz
    AND e.created_at < v_period.period_end::timestamptz
    AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO UPDATE SET
    points = EXCLUDED.points,
    metadata = EXCLUDED.metadata;

  -- Aggregate all score events into summary scores
  INSERT INTO public.community_contribution_scores (
    period_id, user_id, base_points, like_points, poll_points, market_points, minigame_points, total_points, status, updated_at
  )
  SELECT
    v_period_id,
    se.user_id,
    COALESCE(SUM(se.points), 0)::int,
    0,
    0,
    0,
    0,
    COALESCE(SUM(se.points), 0)::int,
    CASE WHEN v_period.status = 'RESOLVED' THEN 'RESOLVED' ELSE 'PENDING' END,
    NOW()
  FROM public.community_contribution_score_events se
  WHERE se.period_id = v_period_id
  GROUP BY se.user_id
  ON CONFLICT (period_id, user_id) DO UPDATE SET
    base_points = EXCLUDED.base_points,
    total_points = EXCLUDED.total_points,
    updated_at = NOW()
  WHERE public.community_contribution_scores.status <> 'SUSPENDED';

  SELECT COUNT(*)::int INTO v_calculated
  FROM public.community_contribution_scores
  WHERE period_id = v_period_id;

  RETURN jsonb_build_object('success', true, 'period_id', v_period_id, 'calculated', v_calculated);
END;
$$;
