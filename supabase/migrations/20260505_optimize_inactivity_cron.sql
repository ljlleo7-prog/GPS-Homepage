-- Optimize minigame inactivity enforcement from every 1 minute to every 5 minutes
-- This reduces cron.job_run_details growth by 80% while keeping detection lag acceptable

-- Unschedule the old every-minute job
SELECT cron.unschedule('onelap_room_inactivity');

-- Reschedule to run every 5 minutes
SELECT cron.schedule(
    'onelap_room_inactivity',
    '*/5 * * * *',
    $$ SELECT public.enforce_one_lap_room_inactivity() $$
);
