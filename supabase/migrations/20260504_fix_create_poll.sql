-- Fix create_community_poll to use developer_status instead of is_developer
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

  SELECT developer_status = 'APPROVED' INTO v_is_developer FROM public.profiles WHERE id = v_user_id;
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
    CASE WHEN p_duration_hours IS NOT NULL AND p_duration_hours > 0
         THEN NOW() + (p_duration_hours || ' hours')::INTERVAL
         ELSE NULL END,
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
