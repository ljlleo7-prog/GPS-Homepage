CREATE OR REPLACE FUNCTION public.play_gt_pit_stop_game(p_score_ms INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_score_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  INSERT INTO public.minigame_scores (user_id, game_type, score_ms, reward_amount)
  VALUES (v_user_id, 'PIT_STOP_GT', p_score_ms, 0)
  RETURNING id INTO v_score_id;

  RETURN jsonb_build_object(
    'success', true,
    'reward', 0,
    'message', 'Score recorded'
  );
END;
$$;
