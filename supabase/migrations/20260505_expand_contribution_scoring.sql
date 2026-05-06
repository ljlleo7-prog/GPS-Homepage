-- Expand contribution scoring to include forum posts/comments even without likes
-- This allows developers to see and validate all contributions, not just liked content

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

  -- Forum post likes (primary scoring)
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    p.author_id,
    'forum_post_likes',
    'forum_post',
    p.id,
    LEAST(COUNT(DISTINCT l.user_id)::int, 10) * 2,
    jsonb_build_object('likes', COUNT(DISTINCT l.user_id), 'title', p.title)
  FROM public.forum_posts p
  JOIN public.forum_likes l ON l.post_id = p.id AND l.user_id <> p.author_id
  LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = p.author_id
  WHERE p.created_at >= v_period.period_start::timestamptz
    AND p.created_at < v_period.period_end::timestamptz
    AND length(trim(COALESCE(p.content, ''))) >= 15
    AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  GROUP BY p.id, p.author_id, p.title
  HAVING COUNT(DISTINCT l.user_id) > 0
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO UPDATE SET
    points = EXCLUDED.points,
    metadata = EXCLUDED.metadata;

  -- Forum posts created (base points, even without likes)
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    p.author_id,
    'forum_post_created',
    'forum_post',
    p.id,
    1,
    jsonb_build_object('title', p.title, 'content_length', length(trim(COALESCE(p.content, ''))))
  FROM public.forum_posts p
  LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = p.author_id
  WHERE p.created_at >= v_period.period_start::timestamptz
    AND p.created_at < v_period.period_end::timestamptz
    AND length(trim(COALESCE(p.content, ''))) >= 15
    AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO UPDATE SET
    points = EXCLUDED.points,
    metadata = EXCLUDED.metadata;

  -- Forum comments created (base points)
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    c.author_id,
    'forum_comment_created',
    'forum_comment',
    c.id,
    1,
    jsonb_build_object('post_id', c.post_id, 'content_length', length(trim(COALESCE(c.content, ''))))
  FROM public.forum_comments c
  LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = c.author_id
  WHERE c.created_at >= v_period.period_start::timestamptz
    AND c.created_at < v_period.period_end::timestamptz
    AND length(trim(COALESCE(c.content, ''))) >= 15
    AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO UPDATE SET
    points = EXCLUDED.points,
    metadata = EXCLUDED.metadata;

  -- Poll votes
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    v.user_id,
    'poll_vote_cast',
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

  -- Other engagement events
  INSERT INTO public.community_contribution_score_events (period_id, user_id, event_type, source_type, source_id, points, metadata)
  SELECT
    v_period_id,
    e.user_id,
    e.event_type,
    e.source_type,
    e.source_id,
    1,
    jsonb_build_object('event_id', e.id)
  FROM public.community_engagement_events e
  LEFT JOIN public.community_contribution_scores s ON s.period_id = v_period_id AND s.user_id = e.user_id
  WHERE e.created_at >= v_period.period_start::timestamptz
    AND e.created_at < v_period.period_end::timestamptz
    AND e.event_type IN ('daily_bonus_claimed', 'minigame_play_completed', 'ticket_listing_created', 'ticket_listing_purchased', 'driver_bet_created', 'driver_bet_ticket_bought')
    AND COALESCE(s.status, 'PENDING') <> 'SUSPENDED'
  ON CONFLICT (period_id, user_id, event_type, source_type, source_id) DO NOTHING;

  -- Aggregate score events into summary scores
  INSERT INTO public.community_contribution_scores (
    period_id, user_id, base_points, like_points, poll_points, market_points, minigame_points, total_points, status, updated_at
  )
  SELECT
    v_period_id,
    se.user_id,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type IN ('forum_post_created', 'forum_comment_created')), 0)::int,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type = 'forum_post_likes'), 0)::int,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type = 'poll_vote_cast'), 0)::int,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type IN ('ticket_listing_created', 'ticket_listing_purchased', 'driver_bet_created', 'driver_bet_ticket_bought')), 0)::int,
    COALESCE(SUM(se.points) FILTER (WHERE se.event_type = 'minigame_play_completed'), 0)::int,
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
