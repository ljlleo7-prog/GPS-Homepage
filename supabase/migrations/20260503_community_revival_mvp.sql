-- ==============================================================================
-- COMMUNITY REVIVAL MVP
-- Engagement logging, quick polls, developer-validated contribution scoring
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT,
  source_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.community_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  question_key TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE' NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
  starts_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.community_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID REFERENCES public.community_polls(id) ON DELETE CASCADE NOT NULL,
  option_key TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (poll_id, option_key)
);

CREATE TABLE IF NOT EXISTS public.community_poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID REFERENCES public.community_polls(id) ON DELETE CASCADE NOT NULL,
  option_id UUID REFERENCES public.community_poll_options(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.community_contribution_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT DEFAULT 'OPEN' NOT NULL CHECK (status IN ('OPEN', 'VALIDATION', 'RESOLVED')),
  auto_resolves_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (period_start, period_end)
);

CREATE TABLE IF NOT EXISTS public.community_contribution_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES public.community_contribution_periods(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  base_points INTEGER DEFAULT 0 NOT NULL CHECK (base_points >= 0),
  like_points INTEGER DEFAULT 0 NOT NULL CHECK (like_points >= 0),
  poll_points INTEGER DEFAULT 0 NOT NULL CHECK (poll_points >= 0),
  market_points INTEGER DEFAULT 0 NOT NULL CHECK (market_points >= 0),
  minigame_points INTEGER DEFAULT 0 NOT NULL CHECK (minigame_points >= 0),
  total_points INTEGER DEFAULT 0 NOT NULL CHECK (total_points >= 0),
  status TEXT DEFAULT 'PENDING' NOT NULL CHECK (status IN ('PENDING', 'SUSPENDED', 'RESOLVED')),
  suspended_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  suspended_at TIMESTAMPTZ,
  suspension_reason TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (period_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.community_contribution_score_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES public.community_contribution_periods(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT,
  source_id UUID,
  points INTEGER DEFAULT 0 NOT NULL CHECK (points >= 0),
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (period_id, user_id, event_type, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS public.community_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  title_key TEXT NOT NULL,
  body_key TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
  is_read BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  read_at TIMESTAMPTZ
);

-- ------------------------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_community_events_created_at ON public.community_engagement_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_events_user_id ON public.community_engagement_events (user_id);
CREATE INDEX IF NOT EXISTS idx_community_events_type ON public.community_engagement_events (event_type);
CREATE INDEX IF NOT EXISTS idx_community_score_events_period ON public.community_contribution_score_events (period_id);
CREATE INDEX IF NOT EXISTS idx_community_score_events_user ON public.community_contribution_score_events (user_id);
CREATE INDEX IF NOT EXISTS idx_community_score_events_source ON public.community_contribution_score_events (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_community_scores_period_status ON public.community_contribution_scores (period_id, status);
CREATE INDEX IF NOT EXISTS idx_community_scores_total ON public.community_contribution_scores (period_id, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_community_poll_votes_poll ON public.community_poll_votes (poll_id);
CREATE INDEX IF NOT EXISTS idx_community_notifications_user_unread ON public.community_notifications (user_id, is_read, created_at DESC);

-- ------------------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------------------

ALTER TABLE public.community_engagement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_contribution_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_contribution_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_contribution_score_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active community polls are public" ON public.community_polls;
CREATE POLICY "Active community polls are public" ON public.community_polls
  FOR SELECT USING (status = 'ACTIVE' AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW()));

DROP POLICY IF EXISTS "Community poll options are public" ON public.community_poll_options;
CREATE POLICY "Community poll options are public" ON public.community_poll_options
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.community_polls p
      WHERE p.id = poll_id
        AND p.status = 'ACTIVE'
        AND p.starts_at <= NOW()
        AND (p.ends_at IS NULL OR p.ends_at > NOW())
    )
  );

DROP POLICY IF EXISTS "Users can read own community poll votes" ON public.community_poll_votes;
CREATE POLICY "Users can read own community poll votes" ON public.community_poll_votes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own community notifications" ON public.community_notifications;
CREATE POLICY "Users can read own community notifications" ON public.community_notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own community notifications" ON public.community_notifications;
CREATE POLICY "Users can update own community notifications" ON public.community_notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own contribution scores" ON public.community_contribution_scores;
CREATE POLICY "Users can read own contribution scores" ON public.community_contribution_scores
  FOR SELECT USING (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_approved_developer(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id AND developer_status = 'APPROVED'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_current_contribution_period()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE := date_trunc('week', NOW())::date;
  v_end DATE := (date_trunc('week', NOW()) + INTERVAL '7 days')::date;
  v_period_id UUID;
BEGIN
  INSERT INTO public.community_contribution_periods (period_start, period_end, auto_resolves_at)
  VALUES (v_start, v_end, (v_end::timestamptz + INTERVAL '2 days'))
  ON CONFLICT (period_start, period_end) DO UPDATE SET period_start = EXCLUDED.period_start
  RETURNING id INTO v_period_id;

  RETURN v_period_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- Public/user RPCs
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_community_engagement(
  p_event_type TEXT,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_event_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  INSERT INTO public.community_engagement_events (user_id, event_type, source_type, source_id, metadata)
  VALUES (v_user_id, p_event_type, p_source_type, p_source_id, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('success', true, 'id', v_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_community_poll_vote(
  p_poll_id UUID,
  p_option_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_poll_active BOOLEAN;
  v_option_valid BOOLEAN;
  v_counts JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.community_polls
    WHERE id = p_poll_id
      AND status = 'ACTIVE'
      AND starts_at <= NOW()
      AND (ends_at IS NULL OR ends_at > NOW())
  ) INTO v_poll_active;

  IF NOT v_poll_active THEN
    RETURN jsonb_build_object('success', false, 'message', 'Poll is not active');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.community_poll_options
    WHERE id = p_option_id AND poll_id = p_poll_id
  ) INTO v_option_valid;

  IF NOT v_option_valid THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid poll option');
  END IF;

  INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
  VALUES (p_poll_id, p_option_id, v_user_id)
  ON CONFLICT (poll_id, user_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'You have already voted');
  END IF;

  PERFORM public.log_community_engagement('poll_vote_cast', 'community_poll', p_poll_id, jsonb_build_object('option_id', p_option_id));

  SELECT jsonb_agg(jsonb_build_object('option_id', option_id, 'votes', votes)) INTO v_counts
  FROM (
    SELECT option_id, COUNT(*)::int AS votes
    FROM public.community_poll_votes
    WHERE poll_id = p_poll_id
    GROUP BY option_id
  ) vote_counts;

  RETURN jsonb_build_object('success', true, 'selected_option_id', p_option_id, 'counts', COALESCE(v_counts, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_community_poll()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_poll RECORD;
  v_options JSONB;
  v_selected UUID;
BEGIN
  SELECT * INTO v_poll
  FROM public.community_polls
  WHERE status = 'ACTIVE'
    AND starts_at <= NOW()
    AND (ends_at IS NULL OR ends_at > NOW())
  ORDER BY starts_at DESC
  LIMIT 1;

  IF v_poll.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'poll', NULL);
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'option_key', o.option_key,
      'sort_order', o.sort_order,
      'votes', COALESCE(v.vote_count, 0)
    ) ORDER BY o.sort_order, o.created_at
  ) INTO v_options
  FROM public.community_poll_options o
  LEFT JOIN (
    SELECT option_id, COUNT(*)::int AS vote_count
    FROM public.community_poll_votes
    WHERE poll_id = v_poll.id
    GROUP BY option_id
  ) v ON v.option_id = o.id
  WHERE o.poll_id = v_poll.id;

  IF v_user_id IS NOT NULL THEN
    SELECT option_id INTO v_selected
    FROM public.community_poll_votes
    WHERE poll_id = v_poll.id AND user_id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'poll', jsonb_build_object(
      'id', v_poll.id,
      'slug', v_poll.slug,
      'question_key', v_poll.question_key,
      'ends_at', v_poll.ends_at,
      'selected_option_id', v_selected,
      'options', COALESCE(v_options, '[]'::jsonb)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_homepage_activity_feed(p_limit INT DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'event_type', e.event_type,
      'source_type', e.source_type,
      'source_id', e.source_id,
      'username', COALESCE(p.username, 'Unknown'),
      'created_at', e.created_at
    ) ORDER BY e.created_at DESC
  ) INTO v_items
  FROM (
    SELECT *
    FROM public.community_engagement_events
    ORDER BY created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 30)
  ) e
  LEFT JOIN public.profiles p ON p.id = e.user_id;

  RETURN jsonb_build_object('success', true, 'items', COALESCE(v_items, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_weekly_community_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - INTERVAL '7 days';
  v_period_id UUID;
  v_active_participants INT;
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

  SELECT COUNT(DISTINCT user_id)::int, COUNT(*)::int
  INTO v_active_participants, v_events
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
    'active_participants', COALESCE(v_active_participants, 0),
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

CREATE OR REPLACE FUNCTION public.get_unread_community_notifications()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_items JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated', 'items', '[]'::jsonb);
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id,
      'type', type,
      'title_key', title_key,
      'body_key', body_key,
      'metadata', metadata,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ) INTO v_items
  FROM public.community_notifications
  WHERE user_id = v_user_id AND is_read = false;

  RETURN jsonb_build_object('success', true, 'items', COALESCE(v_items, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_community_notification_read(p_notification_id UUID)
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

  UPDATE public.community_notifications
  SET is_read = true, read_at = NOW()
  WHERE id = p_notification_id AND user_id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ------------------------------------------------------------------------------
-- Developer validation RPCs
-- ------------------------------------------------------------------------------

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

  DELETE FROM public.community_contribution_score_events se
  WHERE se.period_id = v_period_id
    AND NOT EXISTS (
      SELECT 1 FROM public.community_contribution_scores s
      WHERE s.period_id = se.period_id
        AND s.user_id = se.user_id
        AND s.status = 'SUSPENDED'
    );

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

  INSERT INTO public.community_contribution_scores (
    period_id, user_id, base_points, like_points, poll_points, market_points, minigame_points, total_points, status, updated_at
  )
  SELECT
    v_period_id,
    se.user_id,
    0,
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
      PERFORM public.calculate_weekly_contribution_scores(v_period_id);
    END IF;
  END IF;

  SELECT * INTO v_period FROM public.community_contribution_periods WHERE id = v_period_id;
  PERFORM public.calculate_weekly_contribution_scores(v_period_id);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'user_id', s.user_id,
      'username', COALESCE(p.username, 'Unknown'),
      'base_points', s.base_points,
      'like_points', s.like_points,
      'poll_points', s.poll_points,
      'market_points', s.market_points,
      'minigame_points', s.minigame_points,
      'total_points', s.total_points,
      'status', s.status,
      'suspension_reason', s.suspension_reason,
      'top_events', COALESCE(ev.events, '[]'::jsonb)
    ) ORDER BY s.total_points DESC, s.updated_at DESC
  ) INTO v_scores
  FROM public.community_contribution_scores s
  LEFT JOIN public.profiles p ON p.id = s.user_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'event_type', event_type,
        'source_type', source_type,
        'source_id', source_id,
        'points', points,
        'metadata', metadata
      ) ORDER BY points DESC, created_at DESC
    ) AS events
    FROM (
      SELECT *
      FROM public.community_contribution_score_events se
      WHERE se.period_id = s.period_id AND se.user_id = s.user_id
      ORDER BY points DESC, created_at DESC
      LIMIT 5
    ) limited_events
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

CREATE OR REPLACE FUNCTION public.suspend_weekly_contribution_score(p_score_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF NOT public.is_approved_developer(v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  UPDATE public.community_contribution_scores
  SET status = 'SUSPENDED',
      suspended_by = v_user_id,
      suspended_at = NOW(),
      suspension_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
      resolved_at = NULL,
      updated_at = NOW()
  WHERE id = p_score_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.unsuspend_weekly_contribution_score(p_score_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_period_status TEXT;
BEGIN
  IF NOT public.is_approved_developer(v_user_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  SELECT cp.status INTO v_period_status
  FROM public.community_contribution_scores s
  JOIN public.community_contribution_periods cp ON cp.id = s.period_id
  WHERE s.id = p_score_id;

  UPDATE public.community_contribution_scores
  SET status = CASE WHEN v_period_status = 'RESOLVED' THEN 'RESOLVED' ELSE 'PENDING' END,
      suspended_by = NULL,
      suspended_at = NULL,
      suspension_reason = NULL,
      resolved_at = CASE WHEN v_period_status = 'RESOLVED' THEN NOW() ELSE NULL END,
      updated_at = NOW()
  WHERE id = p_score_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_resolve_weekly_contribution_scores(p_period_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id UUID := p_period_id;
  v_resolved INT := 0;
BEGIN
  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id
    FROM public.community_contribution_periods
    WHERE auto_resolves_at <= NOW() AND status <> 'RESOLVED'
    ORDER BY period_start ASC
    LIMIT 1;
  END IF;

  IF v_period_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'resolved', 0);
  END IF;

  PERFORM public.calculate_weekly_contribution_scores(v_period_id);

  UPDATE public.community_contribution_scores
  SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW()
  WHERE period_id = v_period_id AND status <> 'SUSPENDED';

  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  UPDATE public.community_contribution_periods
  SET status = 'RESOLVED', resolved_at = NOW()
  WHERE id = v_period_id
    AND NOT EXISTS (
      SELECT 1 FROM public.community_contribution_scores
      WHERE period_id = v_period_id AND status = 'SUSPENDED'
    );

  RETURN jsonb_build_object('success', true, 'period_id', v_period_id, 'resolved', v_resolved);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_weekly_contributor_leaderboard(p_limit INT DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', s.user_id,
      'username', COALESCE(p.username, 'Unknown'),
      'total_points', s.total_points,
      'like_points', s.like_points,
      'poll_points', s.poll_points,
      'market_points', s.market_points,
      'minigame_points', s.minigame_points
    ) ORDER BY s.total_points DESC
  ) INTO v_items
  FROM public.community_contribution_scores s
  JOIN public.community_contribution_periods cp ON cp.id = s.period_id
  LEFT JOIN public.profiles p ON p.id = s.user_id
  WHERE s.status = 'RESOLVED'
    AND cp.status = 'RESOLVED'
    AND s.total_points > 0
  ORDER BY cp.period_start DESC, s.total_points DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 30);

  RETURN jsonb_build_object('success', true, 'items', COALESCE(v_items, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.create_community_poll(
  p_slug TEXT,
  p_question_key TEXT,
  p_options JSONB,
  p_duration_hours INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_developer BOOLEAN;
  v_poll_id UUID;
  v_option JSONB;
  v_sort_order INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT is_developer INTO v_is_developer FROM public.profiles WHERE id = v_user_id;
  IF NOT COALESCE(v_is_developer, false) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  IF p_slug IS NULL OR p_question_key IS NULL OR p_options IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Missing required fields');
  END IF;

  IF jsonb_array_length(p_options) < 2 THEN
    RETURN jsonb_build_object('success', false, 'message', 'At least 2 options required');
  END IF;

  INSERT INTO public.community_polls (slug, question_key, status, ends_at, created_by)
  VALUES (
    p_slug,
    p_question_key,
    'ACTIVE',
    CASE WHEN p_duration_hours IS NOT NULL THEN NOW() + (p_duration_hours || ' hours')::INTERVAL ELSE NULL END,
    v_user_id
  )
  RETURNING id INTO v_poll_id;

  FOR v_option IN SELECT * FROM jsonb_array_elements(p_options)
  LOOP
    INSERT INTO public.community_poll_options (poll_id, option_key, sort_order)
    VALUES (v_poll_id, v_option->>'option_key', v_sort_order);
    v_sort_order := v_sort_order + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'poll_id', v_poll_id);
END;
$$;
