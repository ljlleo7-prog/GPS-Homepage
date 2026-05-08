-- F1 Team Deduction Game Schema
-- MVP database structure for social deduction multiplayer game

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE deduction_room_status AS ENUM (
  'lobby',
  'ready',
  'night_phase',
  'race_resolution',
  'discussion',
  'voting',
  'ended'
);

CREATE TYPE deduction_role AS ENUM (
  'TP',  -- Team Principal (public)
  'TC',  -- Technician
  'IS',  -- Inspector
  'ST'   -- Strategist
);

CREATE TYPE deduction_alignment AS ENUM (
  'positive',
  'negative'
);

CREATE TYPE deduction_action_type AS ENUM (
  'tc_protect',
  'tc_sabotage',
  'is_check',
  'is_leak',
  'st_strategic_sabotage',
  'tp_influence'
);

-- ============================================================================
-- ROOMS TABLE
-- ============================================================================

CREATE TABLE deduction_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id UUID NOT NULL REFERENCES auth.users(id),
  status deduction_room_status NOT NULL DEFAULT 'lobby',

  -- Room settings
  settings JSONB NOT NULL DEFAULT '{
    "max_players": 6,
    "total_races": 12,
    "negative_count": null,
    "tp_negative_mode": "off",
    "language": "en",
    "allow_bots": true,
    "base_dnf_rate": 0.2,
    "timer_night": 60,
    "timer_discussion": 120,
    "timer_voting": 60
  }'::jsonb,

  -- Season state
  season_seed TEXT NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,

  -- Winner info
  winning_alignment deduction_alignment,
  expulsion_reason TEXT
);

CREATE INDEX idx_deduction_rooms_status ON deduction_rooms(status);
CREATE INDEX idx_deduction_rooms_host ON deduction_rooms(host_user_id);

-- ============================================================================
-- ROOM PLAYERS TABLE
-- ============================================================================

CREATE TABLE deduction_room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES deduction_rooms(id) ON DELETE CASCADE,
  seat_index INTEGER NOT NULL,

  -- Identity
  user_id UUID REFERENCES auth.users(id),
  bot_id TEXT,  -- bot identifier if this is a bot
  display_name TEXT NOT NULL,

  -- Game state
  role deduction_role NOT NULL,
  alignment deduction_alignment NOT NULL,
  is_tp BOOLEAN NOT NULL DEFAULT false,
  is_alive BOOLEAN NOT NULL DEFAULT true,
  was_fired_round INTEGER,

  -- Private state (only visible to this player)
  private_state JSONB NOT NULL DEFAULT '{
    "known_alignments": {},
    "action_results": []
  }'::jsonb,

  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_room_seat UNIQUE(room_id, seat_index),
  CONSTRAINT unique_room_user UNIQUE(room_id, user_id),
  CONSTRAINT player_identity CHECK (
    (user_id IS NOT NULL AND bot_id IS NULL) OR
    (user_id IS NULL AND bot_id IS NOT NULL)
  )
);

CREATE INDEX idx_deduction_players_room ON deduction_room_players(room_id);
CREATE INDEX idx_deduction_players_user ON deduction_room_players(user_id);

-- ============================================================================
-- SEASON STATE TABLE
-- ============================================================================

CREATE TABLE deduction_season_state (
  room_id UUID PRIMARY KEY REFERENCES deduction_rooms(id) ON DELETE CASCADE,

  -- Expulsion tracks
  board_pressure INTEGER NOT NULL DEFAULT 0,
  integrity_pressure INTEGER NOT NULL DEFAULT 0,
  sporting_pressure INTEGER NOT NULL DEFAULT 0,
  consecutive_dnfs INTEGER NOT NULL DEFAULT 0,

  -- Thresholds (from season rules)
  board_threshold INTEGER NOT NULL DEFAULT 3,
  integrity_threshold INTEGER NOT NULL DEFAULT 100,
  sporting_threshold INTEGER NOT NULL DEFAULT 5,

  -- Season config
  season_rules JSONB NOT NULL DEFAULT '{}'::jsonb,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- RACES TABLE
-- ============================================================================

CREATE TABLE deduction_races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES deduction_rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,

  -- Race context
  track_name TEXT NOT NULL,
  track_id TEXT,
  weather_tags TEXT[] DEFAULT '{}',
  risk_modifier DECIMAL(3,2) DEFAULT 1.0,

  -- RNG
  round_seed TEXT NOT NULL,

  -- Results
  driver_1_dnf BOOLEAN,
  driver_2_dnf BOOLEAN,
  driver_1_performance INTEGER,  -- 0-100 scale
  driver_2_performance INTEGER,

  -- Public report
  public_report TEXT,

  -- Internal state
  result_state JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_room_round UNIQUE(room_id, round_number)
);

CREATE INDEX idx_deduction_races_room ON deduction_races(room_id);

-- ============================================================================
-- ACTIONS TABLE
-- ============================================================================

CREATE TABLE deduction_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES deduction_rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  player_id UUID NOT NULL REFERENCES deduction_room_players(id) ON DELETE CASCADE,

  action_type deduction_action_type NOT NULL,
  action_target TEXT,  -- player_id or driver identifier

  -- Resolution
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_result JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_player_round_action UNIQUE(room_id, round_number, player_id)
);

CREATE INDEX idx_deduction_actions_room_round ON deduction_actions(room_id, round_number);
CREATE INDEX idx_deduction_actions_player ON deduction_actions(player_id);

-- ============================================================================
-- VOTES TABLE
-- ============================================================================

CREATE TABLE deduction_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES deduction_rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  voter_player_id UUID NOT NULL REFERENCES deduction_room_players(id) ON DELETE CASCADE,
  target_player_id UUID NOT NULL REFERENCES deduction_room_players(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_voter_round UNIQUE(room_id, round_number, voter_player_id)
);

CREATE INDEX idx_deduction_votes_room_round ON deduction_votes(room_id, round_number);

-- ============================================================================
-- BOT MEMORY TABLE
-- ============================================================================

CREATE TABLE deduction_bot_memory (
  bot_player_id UUID PRIMARY KEY REFERENCES deduction_room_players(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES deduction_rooms(id) ON DELETE CASCADE,

  -- Suspicion tracking (player_id -> score 0-100)
  suspicion_scores JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Trust tracking (player_id -> score 0-100)
  trust_scores JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Phrase cooldowns (phrase_id -> last_used_round)
  phrase_cooldowns JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Memory of claims and votes
  vote_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  claim_history JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- General memory state
  memory_state JSONB NOT NULL DEFAULT '{}'::jsonb,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deduction_bot_memory_room ON deduction_bot_memory(room_id);

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================

CREATE TABLE deduction_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES deduction_rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  author_player_id UUID NOT NULL REFERENCES deduction_room_players(id) ON DELETE CASCADE,

  content TEXT NOT NULL,
  generated_by_bot BOOLEAN NOT NULL DEFAULT false,

  -- Visibility control (for future private messages)
  visibility TEXT NOT NULL DEFAULT 'public',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deduction_messages_room_round ON deduction_messages(room_id, round_number);
CREATE INDEX idx_deduction_messages_created ON deduction_messages(created_at DESC);

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

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

ALTER TABLE deduction_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE deduction_room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE deduction_season_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE deduction_races ENABLE ROW LEVEL SECURITY;
ALTER TABLE deduction_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deduction_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE deduction_bot_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE deduction_messages ENABLE ROW LEVEL SECURITY;

-- Rooms: visible to all authenticated users
CREATE POLICY "Rooms are viewable by authenticated users"
  ON deduction_rooms FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create rooms"
  ON deduction_rooms FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = host_user_id);

CREATE POLICY "Hosts can update their rooms"
  ON deduction_rooms FOR UPDATE
  TO authenticated
  USING (auth.uid() = host_user_id);

-- Players: public projection is exposed through deduction_room_players_public.
CREATE POLICY "Players are readable by authenticated users"
  ON deduction_room_players FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can join rooms"
  ON deduction_room_players FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Season state: public room progress is visible to authenticated users
CREATE POLICY "Season state viewable by authenticated users"
  ON deduction_season_state FOR SELECT
  TO authenticated
  USING (true);

-- Races: public race reports are visible to authenticated users
CREATE POLICY "Races viewable by authenticated users"
  ON deduction_races FOR SELECT
  TO authenticated
  USING (true);

-- Actions: only visible to action owner (secret)
CREATE POLICY "Actions viewable by owner only"
  ON deduction_actions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deduction_room_players
      WHERE id = deduction_actions.player_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can submit actions"
  ON deduction_actions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM deduction_room_players
      WHERE id = player_id
      AND user_id = auth.uid()
    )
  );

-- Votes: only visible to voter (secret until resolution)
CREATE POLICY "Votes viewable by voter only"
  ON deduction_votes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deduction_room_players
      WHERE id = deduction_votes.voter_player_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can submit votes"
  ON deduction_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM deduction_room_players
      WHERE id = voter_player_id
      AND user_id = auth.uid()
    )
  );

-- Bot memory: never visible to clients
CREATE POLICY "Bot memory not accessible"
  ON deduction_bot_memory FOR SELECT
  TO authenticated
  USING (false);

-- Messages: visible to room members
CREATE POLICY "Messages viewable by room members"
  ON deduction_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM deduction_room_players
      WHERE room_id = deduction_messages.room_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can post messages"
  ON deduction_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM deduction_room_players
      WHERE id = author_player_id
      AND user_id = auth.uid()
    )
  );
