-- Schedule and harden weekly contribution auto-resolution

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.auto_resolve_weekly_contribution_scores(p_period_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period RECORD;
  v_periods_resolved INT := 0;
  v_scores_resolved INT := 0;
  v_last_period_id UUID := NULL;
  v_row_count INT := 0;
BEGIN
  FOR v_period IN
    SELECT *
    FROM public.community_contribution_periods
    WHERE status <> 'RESOLVED'
      AND (p_period_id IS NOT NULL AND id = p_period_id OR p_period_id IS NULL AND auto_resolves_at <= NOW())
    ORDER BY period_start ASC
  LOOP
    PERFORM public.calculate_weekly_contribution_scores(v_period.id);

    UPDATE public.community_contribution_scores
    SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW()
    WHERE period_id = v_period.id
      AND status <> 'SUSPENDED';

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_scores_resolved := v_scores_resolved + v_row_count;

    UPDATE public.community_contribution_periods
    SET status = 'RESOLVED', resolved_at = NOW()
    WHERE id = v_period.id
      AND NOT EXISTS (
        SELECT 1 FROM public.community_contribution_scores
        WHERE period_id = v_period.id AND status = 'SUSPENDED'
      );

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_periods_resolved := v_periods_resolved + v_row_count;
    v_last_period_id := v_period.id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'period_id', v_last_period_id,
    'periods_resolved', v_periods_resolved,
    'resolved', v_scores_resolved
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-resolve-weekly-contribution-scores') THEN
    PERFORM cron.unschedule('auto-resolve-weekly-contribution-scores');
  END IF;
END;
$$;

SELECT cron.schedule(
  'auto-resolve-weekly-contribution-scores',
  '17 4 * * *',
  $$SELECT public.auto_resolve_weekly_contribution_scores()$$
);

SELECT public.auto_resolve_weekly_contribution_scores();
