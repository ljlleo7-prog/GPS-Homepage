-- Fix get_homepage_activity_feed GROUP BY error

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
      'id', sub.id,
      'event_type', sub.event_type,
      'source_type', sub.source_type,
      'source_id', sub.source_id,
      'username', sub.username,
      'created_at', sub.created_at
    )
  ) INTO v_events
  FROM (
    SELECT
      e.id,
      e.event_type,
      e.source_type,
      e.source_id,
      p.username,
      e.created_at
    FROM public.community_engagement_events e
    INNER JOIN public.profiles p ON e.user_id = p.id
    WHERE p.show_activity = true
    ORDER BY e.created_at DESC
    LIMIT p_limit
  ) sub;

  RETURN jsonb_build_object('success', true, 'events', COALESCE(v_events, '[]'::jsonb));
END;
$$;
