-- Categorized contribution scoring with quality bonuses and spam prevention
-- Base: 1 point per event, Bonus: likes and quality, Limits: max per type per week

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

  -- Forum posts: 1 base + like bonus (max 10 likes = +20 pts), limited to 15 posts/week
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    p.author_id,
    'forum_post',
    'forum_post',
    p.id,
    1 + LEAST(COALESCE(like_count, 0), 10) * 2,
    jsonb_build_object('title', p.title, 'likes', COALESCE(like_count, 0), 'length', length(trim(COALESCE(p.content, ''))))
  FROM (
    SELECT p.*, COUNT(DISTINCT l.user_id) FILTER (WHERE l.user_id <> p.author_id) as like_count,
           ROW_NUMBER() OVER (PARTITION BY p.author_id ORDER BY p.created_at) as rn
    FROM public.forum_posts p
    LEFT JOIN public.forum_likes l ON l.post_id = p.id
    LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = p.author_id
    WHERE p.created_at >= v_period.period_start::timestamptz
      AND p.created_at < v_period.period_end::timestamptz
      AND length(trim(COALESCE(p.content, ''))) >= 15
      AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
    GROUP BY p.id
  ) p
  WHERE p.rn <= 15
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO UPDATE SET
    points = EXCLUDED.points,
    metadata = EXCLUDED.metadata;

  -- Forum comments: 1 base point, limited to 30 comments/week
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    c.author_id,
    'forum_comment',
    'forum_comment',
    c.id,
    1,
    jsonb_build_object('post_id', c.post_id, 'length', length(trim(COALESCE(c.content, ''))))
  FROM (
    SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.author_id ORDER BY c.created_at) as rn
    FROM public.forum_comments c
    LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = c.author_id
    WHERE c.created_at >= v_period.period_start::timestamptz
      AND c.created_at < v_period.period_end::timestamptz
      AND length(trim(COALESCE(c.content, ''))) >= 15
      AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  ) c
  WHERE c.rn <= 30
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO UPDATE SET
    points = EXCLUDED.points,
    metadata = EXCLUDED.metadata;

  -- Daily bonus: 1 point, max 7/week (once per day)
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    e.user_id,
    'daily_bonus',
    e.source_type,
    e.source_id,
    1,
    e.metadata
  FROM (
    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at) as rn
    FROM public.community_engagement_events e
    LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = e.user_id
    WHERE e.created_at >= v_period.period_start::timestamptz
      AND e.created_at < v_period.period_end::timestamptz
      AND e.event_type = 'daily_bonus_claimed'
      AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  ) e
  WHERE e.rn <= 7
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO UPDATE SET
    points = EXCLUDED.points,
    metadata = EXCLUDED.metadata;

  -- Minigame plays: 1 point, max 20/week
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    e.user_id,
    'minigame',
    e.source_type,
    e.source_id,
    1,
    e.metadata
  FROM (
    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at) as rn
    FROM public.community_engagement_events e
    LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = e.user_id
    WHERE e.created_at >= v_period.period_start::timestamptz
      AND e.created_at < v_period.period_end::timestamptz
      AND e.event_type = 'minigame_play_completed'
      AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  ) e
  WHERE e.rn <= 20
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO UPDATE SET
    points = EXCLUDED.points,
    metadata = EXCLUDED.metadata;

  -- Poll votes: 1 point, no strict limit (limited by available polls)
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    v.user_id,
    'poll_vote',
    'community_poll',
    v.poll_id,
    1,
    jsonb_build_object('option_id', v.option_id)
  FROM public.community_poll_votes v
  LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = v.user_id
  WHERE v.created_at >= v_period.period_start::timestamptz
    AND v.created_at < v_period.period_end::timestamptz
    AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO NOTHING;

  -- Market actions (tickets, bets): 1 point, max 15/week
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    e.user_id,
    'market_action',
    e.source_type,
    e.source_id,
    1,
    e.metadata
  FROM (
    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at) as rn
    FROM public.community_engagement_events e
    LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = e.user_id
    WHERE e.created_at >= v_period.period_start::timestamptz
      AND e.created_at < v_period.period_end::timestamptz
      AND e.event_type IN ('ticket_listing_created', 'ticket_listing_purchased', 'driver_bet_created', 'driver_bet_ticket_bought')
      AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  ) e
  WHERE e.rn <= 15
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO UPDATE SET
    points = EXCLUDED.points,
    metadata = EXCLUDED.metadata;

  -- Aggregate score events into summary scores by category
  INSERT INTO public.community_contribution_scores (
    period_id, user_id, base_points, like_points, poll_points, market_points, minigame_points, total_points, status, updated_at
  )
  SELECT
    v_period_id,
    se.user_id,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type IN ('forum_comment')), 0)::int,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type = 'forum_post'), 0)::int,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type = 'poll_vote'), 0)::int,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type = 'market_action'), 0)::int,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type IN ('minigame', 'daily_bonus')), 0)::int,
    COALESCE(SUM(se.points), 0)::int,
    CASE WHEN v_period.status = 'RESOLVED' THEN 'RESOLVED' ELSE 'PENDING' END,
    NOW()
  FROM public.community_contribution_score_events se
  WHERE se.period_id = v_period_id
  GROUP BY se.user_id
  ON CONFLICT (period_id, user_id) DO UPDATE SET
    base_points = EXCLUDED.base_points,
    like_points = EXCLUDED.like_points,
    poll_points = EXCLUDED.poll_points,
    market_points = EXCLUDED.market_points,
    minigame_points = EXCLUDED.minigame_points,
    total_points = EXCLUDED.total_points,
    updated_at = NOW()
  WHERE public.community_contribution_scores.status <> 'SUSPENDED';

  SELECT COUNT(*)::int INTO v_calculated
  FROM public.community_contribution_scores
  WHERE period_id = v_period_id;

  RETURN jsonb_build_object('success', true, 'period_id', v_period_id, 'calculated', v_calculated);
END;
$$;
