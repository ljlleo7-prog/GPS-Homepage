-- Add passcode field to forum_rooms for private rooms
ALTER TABLE public.forum_rooms
ADD COLUMN IF NOT EXISTS passcode TEXT;

-- Add can_create_private_rooms to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS can_create_private_rooms BOOLEAN DEFAULT false;

-- Set developers to have private room creation privilege by default
UPDATE public.profiles
SET can_create_private_rooms = true
WHERE developer_status = 'APPROVED';

-- Create private room access requests table
CREATE TABLE IF NOT EXISTS public.forum_private_room_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  identifiable_name TEXT NOT NULL,
  organization TEXT,
  status TEXT DEFAULT 'PENDING' NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'DENIED')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RLS for private room requests
ALTER TABLE public.forum_private_room_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own requests"
ON public.forum_private_room_requests FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create requests"
ON public.forum_private_room_requests FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Developers can view all requests"
ON public.forum_private_room_requests FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND developer_status = 'APPROVED'
  )
);

-- RPC to join a private room by passcode
CREATE OR REPLACE FUNCTION public.join_private_room(p_passcode TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT * INTO v_room
  FROM public.forum_rooms
  WHERE passcode = p_passcode AND passcode IS NOT NULL;

  IF v_room.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid passcode');
  END IF;

  RETURN jsonb_build_object('success', true, 'room', row_to_json(v_room));
END;
$$;

-- RPC to request private room creation access
CREATE OR REPLACE FUNCTION public.request_private_room_access(
  p_identifiable_name TEXT,
  p_organization TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing_pending BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.forum_private_room_requests
    WHERE user_id = v_user_id AND status = 'PENDING'
  ) INTO v_existing_pending;

  IF v_existing_pending THEN
    RETURN jsonb_build_object('success', false, 'message', 'You already have a pending request');
  END IF;

  INSERT INTO public.forum_private_room_requests (user_id, identifiable_name, organization)
  VALUES (v_user_id, p_identifiable_name, p_organization);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC to approve private room access request
CREATE OR REPLACE FUNCTION public.approve_private_room_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_developer BOOLEAN;
  v_target_user_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT developer_status = 'APPROVED' INTO v_is_developer
  FROM public.profiles WHERE id = v_user_id;

  IF NOT COALESCE(v_is_developer, false) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  SELECT user_id INTO v_target_user_id
  FROM public.forum_private_room_requests
  WHERE id = p_request_id;

  IF v_target_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Request not found');
  END IF;

  UPDATE public.forum_private_room_requests
  SET status = 'APPROVED', reviewed_by = v_user_id, reviewed_at = NOW()
  WHERE id = p_request_id;

  UPDATE public.profiles
  SET can_create_private_rooms = true
  WHERE id = v_target_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC to deny private room access request
CREATE OR REPLACE FUNCTION public.deny_private_room_request(p_request_id UUID)
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

  UPDATE public.forum_private_room_requests
  SET status = 'DENIED', reviewed_by = v_user_id, reviewed_at = NOW()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
