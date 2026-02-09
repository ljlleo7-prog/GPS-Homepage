ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS decline_message TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS decline_notified BOOLEAN DEFAULT false;

ALTER TABLE public.test_player_requests ADD COLUMN IF NOT EXISTS decline_message TEXT;
ALTER TABLE public.test_player_requests ADD COLUMN IF NOT EXISTS notified BOOLEAN DEFAULT false;

CREATE OR REPLACE FUNCTION public.decline_developer_access(target_user_id UUID, p_message TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller UUID;
  v_is_dev BOOLEAN;
BEGIN
  v_caller := auth.uid();
  SELECT (developer_status = 'APPROVED') INTO v_is_dev FROM public.profiles WHERE id = v_caller;
  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;
  UPDATE public.profiles
  SET developer_status = 'DECLINED',
      decline_message = p_message,
      decline_notified = false
  WHERE id = target_user_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_developer_decline()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user UUID;
BEGIN
  v_user := auth.uid();
  UPDATE public.profiles
  SET developer_status = 'NONE',
      decline_notified = true,
      decline_message = NULL
  WHERE id = v_user AND developer_status = 'DECLINED';
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_test_player_request(p_request_id UUID, p_message TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin UUID;
  v_is_dev BOOLEAN;
BEGIN
  v_admin := auth.uid();
  SELECT (developer_status = 'APPROVED') INTO v_is_dev FROM public.profiles WHERE id = v_admin;
  IF NOT v_is_dev THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;
  UPDATE public.test_player_requests
  SET status = 'REJECTED',
      decline_message = p_message,
      notified = false,
      updated_at = NOW()
  WHERE id = p_request_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.acknowledge_test_player_decline(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user UUID;
  v_owner UUID;
BEGIN
  v_user := auth.uid();
  SELECT user_id INTO v_owner FROM public.test_player_requests WHERE id = p_request_id;
  IF v_owner IS NULL OR v_owner != v_user THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;
  UPDATE public.test_player_requests
  SET notified = true,
      updated_at = NOW()
  WHERE id = p_request_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
