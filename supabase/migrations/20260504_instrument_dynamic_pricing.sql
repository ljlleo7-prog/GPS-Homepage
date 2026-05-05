-- Track instrument acceptance/rejection events for dynamic pricing
CREATE TABLE IF NOT EXISTS public.instrument_price_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('ACCEPTED', 'REJECTED')),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_instrument_price_events_instrument ON public.instrument_price_events (instrument_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instrument_price_events_type ON public.instrument_price_events (instrument_id, event_type, created_at DESC);

-- RLS for instrument_price_events
ALTER TABLE public.instrument_price_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view instrument price events"
ON public.instrument_price_events FOR SELECT
USING (true);

-- RPC to record instrument event (accept/reject)
CREATE OR REPLACE FUNCTION public.record_instrument_event(
  p_instrument_id UUID,
  p_event_type TEXT
)
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

  IF p_event_type NOT IN ('ACCEPTED', 'REJECTED') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Invalid event type');
  END IF;

  INSERT INTO public.instrument_price_events (instrument_id, event_type, user_id)
  VALUES (p_instrument_id, p_event_type, v_user_id);

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC to get recent instrument events (top N)
CREATE OR REPLACE FUNCTION public.get_instrument_price_events(
  p_instrument_id UUID,
  p_limit INTEGER DEFAULT 10
)
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
      'username', p.username,
      'created_at', e.created_at
    )
    ORDER BY e.created_at DESC
  ) INTO v_events
  FROM public.instrument_price_events e
  LEFT JOIN public.profiles p ON e.user_id = p.id
  WHERE e.instrument_id = p_instrument_id
  ORDER BY e.created_at DESC
  LIMIT p_limit;

  RETURN jsonb_build_object('success', true, 'events', COALESCE(v_events, '[]'::jsonb));
END;
$$;

-- RPC to adjust instrument price based on recent events (last 7 days)
-- Continuous impact: each accept/reject adds a decaying modifier
-- Recent events have more impact than older ones
CREATE OR REPLACE FUNCTION public.get_acceptance_modifier(p_instrument_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_modifier NUMERIC := 0;
  v_age_days NUMERIC;
  v_decay_factor NUMERIC;
BEGIN
  FOR v_event IN
    SELECT event_type, created_at
    FROM public.instrument_price_events
    WHERE instrument_id = p_instrument_id
      AND created_at >= NOW() - INTERVAL '30 days'
    ORDER BY created_at DESC
  LOOP
    v_age_days := EXTRACT(EPOCH FROM (NOW() - v_event.created_at)) / 86400.0;
    v_decay_factor := EXP(-v_age_days / 10.0);

    IF v_event.event_type = 'ACCEPTED' THEN
      v_modifier := v_modifier + (0.05 * v_decay_factor);
    ELSE
      v_modifier := v_modifier - (0.05 * v_decay_factor);
    END IF;
  END LOOP;

  RETURN GREATEST(-0.5, LEAST(0.5, v_modifier));
END;
$$;
