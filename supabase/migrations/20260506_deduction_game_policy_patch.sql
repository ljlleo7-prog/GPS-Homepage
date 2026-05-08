-- F1 Team Deduction Game policy/view patch
-- Run after 20260506_deduction_game_schema.sql if the base tables/policies already exist.

-- Expose a masked player projection for client reads without leaking hidden roles/alignment.
DROP VIEW IF EXISTS deduction_room_players_public;

CREATE VIEW deduction_room_players_public AS
SELECT
  id,
  room_id,
  seat_index,
  user_id,
  bot_id,
  display_name,
  CASE
    WHEN is_tp OR user_id = auth.uid() OR was_fired_round IS NOT NULL THEN role
    ELSE NULL
  END AS role,
  CASE
    WHEN user_id = auth.uid() OR was_fired_round IS NOT NULL THEN alignment
    ELSE NULL
  END AS alignment,
  is_tp,
  is_alive,
  was_fired_round,
  CASE
    WHEN user_id = auth.uid() THEN private_state
    ELSE '{"known_alignments": {}, "action_results": []}'::jsonb
  END AS private_state,
  joined_at
FROM deduction_room_players;

GRANT SELECT ON deduction_room_players_public TO authenticated;

-- Replace the self-referential player SELECT policy that can cause infinite RLS recursion.
DROP POLICY IF EXISTS "Players viewable by room members" ON deduction_room_players;
DROP POLICY IF EXISTS "Players are readable by authenticated users" ON deduction_room_players;

CREATE POLICY "Players are readable by authenticated users"
  ON deduction_room_players FOR SELECT
  TO authenticated
  USING (true);

-- Replace policies that depended on the recursive player policy.
DROP POLICY IF EXISTS "Season state viewable by room members" ON deduction_season_state;
DROP POLICY IF EXISTS "Season state viewable by authenticated users" ON deduction_season_state;

CREATE POLICY "Season state viewable by authenticated users"
  ON deduction_season_state FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Races viewable by room members" ON deduction_races;
DROP POLICY IF EXISTS "Races viewable by authenticated users" ON deduction_races;

CREATE POLICY "Races viewable by authenticated users"
  ON deduction_races FOR SELECT
  TO authenticated
  USING (true);
