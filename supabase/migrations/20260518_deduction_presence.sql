-- Add presence and activity tracking to deduction rooms and players

ALTER TABLE deduction_rooms
  ADD COLUMN last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN shutdown_at TIMESTAMPTZ,
  ADD COLUMN shutdown_reason TEXT;

ALTER TABLE deduction_room_players
  ADD COLUMN last_active_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN left_at TIMESTAMPTZ,
  ADD COLUMN is_online BOOLEAN DEFAULT TRUE;

CREATE INDEX idx_deduction_rooms_activity ON deduction_rooms(last_activity_at);
CREATE INDEX idx_deduction_players_activity ON deduction_room_players(last_active_at);

-- Inactivity enforcement function
CREATE OR REPLACE FUNCTION public.enforce_deduction_room_inactivity()
RETURNS void AS $$
DECLARE
  inactive_threshold INTERVAL := '5 minutes';
  room_record RECORD;
  online_count INTEGER;
  new_host_id UUID;
BEGIN
  -- Mark players offline if inactive beyond threshold or if they left
  UPDATE deduction_room_players
  SET is_online = FALSE
  WHERE (last_active_at < NOW() - inactive_threshold OR left_at IS NOT NULL)
    AND is_online = TRUE;

  -- Process each room
  FOR room_record IN
    SELECT id, host_user_id, status
    FROM deduction_rooms
    WHERE status NOT IN ('ended') AND shutdown_at IS NULL
  LOOP
    -- Count online players
    SELECT COUNT(*) INTO online_count
    FROM deduction_room_players
    WHERE room_id = room_record.id
      AND left_at IS NULL
      AND last_active_at >= NOW() - inactive_threshold;

    -- If no online players, shut down the room
    IF online_count = 0 THEN
      UPDATE deduction_rooms
      SET status = 'ended',
          shutdown_at = NOW(),
          shutdown_reason = 'no_active_players'
      WHERE id = room_record.id;
      CONTINUE;
    END IF;

    -- Check if host is still online
    IF NOT EXISTS (
      SELECT 1 FROM deduction_room_players
      WHERE room_id = room_record.id
        AND user_id = room_record.host_user_id
        AND left_at IS NULL
        AND last_active_at >= NOW() - inactive_threshold
    ) THEN
      -- Transfer host to earliest joined online player
      SELECT user_id INTO new_host_id
      FROM deduction_room_players
      WHERE room_id = room_record.id
        AND user_id IS NOT NULL
        AND left_at IS NULL
        AND last_active_at >= NOW() - inactive_threshold
      ORDER BY joined_at ASC
      LIMIT 1;

      IF new_host_id IS NOT NULL THEN
        UPDATE deduction_rooms
        SET host_user_id = new_host_id,
            last_activity_at = NOW()
        WHERE id = room_record.id;
      END IF;
    END IF;

    -- Update room activity timestamp
    UPDATE deduction_rooms
    SET last_activity_at = NOW()
    WHERE id = room_record.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule enforcement to run every 5 minutes
SELECT cron.schedule(
    'deduction_room_inactivity',
    '*/5 * * * *',
    $$ SELECT public.enforce_deduction_room_inactivity() $$
);
