-- Add room_ids field to community_polls for room-specific display
ALTER TABLE public.community_polls
ADD COLUMN IF NOT EXISTS room_ids UUID[] DEFAULT NULL;

-- NULL means display globally, array of room IDs means display only in those rooms

-- RPC to edit a community poll
CREATE OR REPLACE FUNCTION public.edit_community_poll(
  p_poll_id UUID,
  p_question_key TEXT,
  p_ends_at TIMESTAMPTZ DEFAULT NULL,
  p_room_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_developer BOOLEAN;
  v_poll_creator UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT developer_status = 'APPROVED' INTO v_is_developer
  FROM public.profiles WHERE id = v_user_id;

  IF NOT COALESCE(v_is_developer, false) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  SELECT created_by INTO v_poll_creator
  FROM public.community_polls
  WHERE id = p_poll_id;

  IF v_poll_creator IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Poll not found');
  END IF;

  UPDATE public.community_polls
  SET
    question_key = p_question_key,
    ends_at = COALESCE(p_ends_at, ends_at),
    room_ids = p_room_ids
  WHERE id = p_poll_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Drop the old version without parameters
DROP FUNCTION IF EXISTS public.get_active_community_poll();

-- Update get_active_community_poll to support room filtering
-- NULL room_ids = display only in public forums
-- Array room_ids = display only in specified rooms
CREATE OR REPLACE FUNCTION public.get_active_community_poll(p_room_id UUID DEFAULT NULL)
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
  v_is_public BOOLEAN := false;
BEGIN
  -- Check if the current room is public (default to false if no room specified)
  IF p_room_id IS NOT NULL THEN
    SELECT COALESCE(is_public, false) INTO v_is_public
    FROM public.forum_rooms
    WHERE id = p_room_id;
  END IF;

  SELECT * INTO v_poll
  FROM public.community_polls
  WHERE status = 'ACTIVE'
    AND starts_at <= NOW()
    AND (ends_at IS NULL OR ends_at > NOW())
    AND (
      -- If room_ids is NULL, only show in public rooms
      (room_ids IS NULL AND v_is_public = true) OR
      -- If room_ids is set, only show in those specific rooms
      (room_ids IS NOT NULL AND p_room_id = ANY(room_ids))
    )
  ORDER BY starts_at DESC
  LIMIT 1;

  IF v_poll.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'poll', NULL);
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT option_id INTO v_selected
    FROM public.community_poll_votes
    WHERE poll_id = v_poll.id AND user_id = v_user_id;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'option_key', o.option_key,
      'sort_order', o.sort_order,
      'votes', (
        SELECT COUNT(*)
        FROM public.community_poll_votes
        WHERE option_id = o.id
      )
    )
    ORDER BY o.sort_order
  ) INTO v_options
  FROM public.community_poll_options o
  WHERE o.poll_id = v_poll.id;

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

-- RPC to delete a community poll
CREATE OR REPLACE FUNCTION public.delete_community_poll(p_poll_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_developer BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT developer_status = 'APPROVED' INTO v_is_developer
  FROM public.profiles WHERE id = v_user_id;

  IF NOT COALESCE(v_is_developer, false) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  DELETE FROM public.community_polls WHERE id = p_poll_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC to finalize (close) a community poll
CREATE OR REPLACE FUNCTION public.finalize_community_poll(p_poll_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_developer BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT developer_status = 'APPROVED' INTO v_is_developer
  FROM public.profiles WHERE id = v_user_id;

  IF NOT COALESCE(v_is_developer, false) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  UPDATE public.community_polls
  SET status = 'CLOSED', ends_at = NOW()
  WHERE id = p_poll_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC to get all polls for management (developer only)
CREATE OR REPLACE FUNCTION public.get_all_community_polls()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_developer BOOLEAN;
  v_polls JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT developer_status = 'APPROVED' INTO v_is_developer
  FROM public.profiles WHERE id = v_user_id;

  IF NOT COALESCE(v_is_developer, false) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'slug', p.slug,
      'question_key', p.question_key,
      'status', p.status,
      'starts_at', p.starts_at,
      'ends_at', p.ends_at,
      'created_at', p.created_at,
      'vote_count', (SELECT COUNT(*) FROM public.community_poll_votes WHERE poll_id = p.id)
    )
    ORDER BY p.created_at DESC
  ) INTO v_polls
  FROM public.community_polls p;

  RETURN jsonb_build_object('success', true, 'polls', COALESCE(v_polls, '[]'::jsonb));
END;
$$;
