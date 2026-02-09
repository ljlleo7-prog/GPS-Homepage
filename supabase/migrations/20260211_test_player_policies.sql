ALTER TABLE public.test_player_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Developers view test requests"
ON public.test_player_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND developer_status = 'APPROVED'
  )
);

CREATE POLICY "Developers process test requests"
ON public.test_player_requests
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND developer_status = 'APPROVED'
  )
);
