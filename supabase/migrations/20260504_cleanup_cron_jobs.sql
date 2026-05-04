-- Cleanup function for cron.job_run_details (keep last 7 days)
CREATE OR REPLACE FUNCTION public.cleanup_cron_job_run_details()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM cron.job_run_details
  WHERE end_time < NOW() - INTERVAL '7 days';
END;
$$;

-- Cleanup function for old one_lap_races (keep last 30 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_one_lap_races()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.one_lap_races
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;

-- Schedule cleanup jobs to run daily at 3 AM
SELECT cron.schedule(
  'cleanup-cron-job-run-details',
  '0 3 * * *',
  $$SELECT public.cleanup_cron_job_run_details()$$
);

SELECT cron.schedule(
  'cleanup-old-one-lap-races',
  '0 3 * * *',
  $$SELECT public.cleanup_old_one_lap_races()$$
);

-- Run initial cleanup
SELECT public.cleanup_cron_job_run_details();
SELECT public.cleanup_old_one_lap_races();
