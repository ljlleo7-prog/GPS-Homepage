CREATE OR REPLACE FUNCTION public.cleanup_one_lap_duel_data(
  p_room_age INTERVAL DEFAULT INTERVAL '2 days',
  p_race_age INTERVAL DEFAULT INTERVAL '60 days'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rooms_deleted INTEGER := 0;
  v_players_deleted INTEGER := 0;
  v_races_deleted INTEGER := 0;
  v_orphans_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.one_lap_room_players rp
  USING public.one_lap_rooms r
  WHERE rp.room_id = r.id
    AND r.created_at < NOW() - p_room_age;
  GET DIAGNOSTICS v_players_deleted = ROW_COUNT;

  DELETE FROM public.one_lap_room_players rp
  WHERE NOT EXISTS (
    SELECT 1 FROM public.one_lap_rooms r WHERE r.id = rp.room_id
  );
  GET DIAGNOSTICS v_orphans_deleted = ROW_COUNT;
  v_players_deleted := v_players_deleted + v_orphans_deleted;

  DELETE FROM public.one_lap_rooms
  WHERE created_at < NOW() - p_room_age;
  GET DIAGNOSTICS v_rooms_deleted = ROW_COUNT;

  DELETE FROM public.one_lap_races
  WHERE created_at < NOW() - p_race_age;
  GET DIAGNOSTICS v_races_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'rooms_deleted', v_rooms_deleted,
    'room_players_deleted', v_players_deleted,
    'races_deleted', v_races_deleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_cron_run_logs(
  p_age INTERVAL DEFAULT INTERVAL '30 days'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INTEGER := 0;
  v_exists BOOLEAN := false;
BEGIN
  SELECT to_regclass('cron.job_run_details') IS NOT NULL INTO v_exists;

  IF v_exists THEN
    EXECUTE 'DELETE FROM cron.job_run_details WHERE end_time < NOW() - $1' USING p_age;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'exists', v_exists,
    'deleted', v_deleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_minigame_dead_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_one_lap JSONB;
  v_cron JSONB;
BEGIN
  v_one_lap := public.cleanup_one_lap_duel_data();
  v_cron := public.cleanup_cron_run_logs();

  RETURN jsonb_build_object(
    'success', true,
    'one_lap', v_one_lap,
    'cron', v_cron
  );
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
DECLARE
  v_jobid INTEGER;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'minigame_cleanup_daily' LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END;
$$;
SELECT cron.schedule(
  'minigame_cleanup_daily',
  '30 3 * * *',
  $$ SELECT public.cleanup_minigame_dead_data(); $$
);
