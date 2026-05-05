-- Add privacy setting for activity display
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS show_activity BOOLEAN DEFAULT false;

-- RPC to update activity privacy setting
CREATE OR REPLACE FUNCTION public.update_activity_privacy(p_show_activity BOOLEAN)
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
  SET show_activity = p_show_activity
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Update get_homepage_activity_feed to respect privacy settings
-- Only affects PUBLIC activity feeds, not developer validation
CREATE OR REPLACE FUNCTION public.get_homepage_activity_feed(p_limit INT DEFAULT 10)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_events JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'event_type', e.event_type,
      'source_type', e.source_type,
      'source_id', e.source_id,
      'username', p.username,
      'created_at', e.created_at
    )
    ORDER BY e.created_at DESC
  ) INTO v_events
  FROM public.community_engagement_events e
  INNER JOIN public.profiles p ON e.user_id = p.id
  WHERE p.show_activity = true
  ORDER BY e.created_at DESC
  LIMIT p_limit;

  RETURN jsonb_build_object('success', true, 'events', COALESCE(v_events, '[]'::jsonb));
END;
$$;

-- RPC to get user's own contribution summary (grouped by type)
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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'event_type', event_type,
      'times', count,
      'total_points', total_points
    )
  ) INTO v_summary
  FROM (
    SELECT
      event_type,
      COUNT(*) as count,
      SUM(points) as total_points
    FROM public.community_contribution_score_events
    WHERE user_id = v_user_id
    GROUP BY event_type
    ORDER BY total_points DESC
  ) grouped;

  SELECT COALESCE(SUM(total_points), 0) INTO v_total_points
  FROM public.community_contribution_scores
  WHERE user_id = v_user_id AND status = 'RESOLVED';

  RETURN jsonb_build_object(
    'success', true,
    'total_points', v_total_points,
    'breakdown', COALESCE(v_summary, '[]'::jsonb)
  );
END;
$$;
