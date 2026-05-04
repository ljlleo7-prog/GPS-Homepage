-- Add edited_at column to forum_posts
ALTER TABLE public.forum_posts
ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- RPC to edit a forum post
CREATE OR REPLACE FUNCTION public.edit_forum_post(
  p_post_id UUID,
  p_title TEXT,
  p_content TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_author_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT author_id INTO v_author_id FROM public.forum_posts WHERE id = p_post_id;

  IF v_author_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Post not found');
  END IF;

  IF v_author_id <> v_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  UPDATE public.forum_posts
  SET title = p_title,
      content = p_content,
      edited_at = NOW(),
      updated_at = NOW()
  WHERE id = p_post_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC to delete a forum post
CREATE OR REPLACE FUNCTION public.delete_forum_post(p_post_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_author_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT author_id INTO v_author_id FROM public.forum_posts WHERE id = p_post_id;

  IF v_author_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Post not found');
  END IF;

  IF v_author_id <> v_user_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  DELETE FROM public.forum_posts WHERE id = p_post_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
