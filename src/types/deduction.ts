// F1 Team Deduction Game Types

export type RoomStatus =
  | 'lobby'
  | 'ready'
  | 'night_phase'
  | 'race_resolution'
  | 'discussion'
  | 'voting'
  | 'ended';

export type Role = 'TP' | 'TC' | 'IS' | 'ST';

export type Alignment = 'positive' | 'negative';

export type ActionType =
  | 'tc_protect'
  | 'tc_sabotage'
  | 'is_check'
  | 'is_leak'
  | 'st_strategic_sabotage'
  | 'tp_influence';

export interface RoomSettings {
  max_players: number;
  total_races: number;
  negative_count: number | null;
  tp_negative_mode: 'off' | 'rare' | 'allowed';
  language: 'en' | 'zh';
  allow_bots: boolean;
  base_dnf_rate: number;
  timer_night: number;
  timer_discussion: number;
  timer_voting: number;
}

export interface DeductionRoom {
  id: string;
  host_user_id: string;
  status: RoomStatus;
  settings: RoomSettings;
  season_seed: string;
  current_round: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  winning_alignment: Alignment | null;
  expulsion_reason: string | null;
  last_activity_at: string;
  shutdown_at: string | null;
  shutdown_reason: string | null;
}

export interface RoomPlayer {
  id: string;
  room_id: string;
  seat_index: number;
  user_id: string | null;
  bot_id: string | null;
  display_name: string;
  role: Role;
  alignment: Alignment;
  is_tp: boolean;
  is_alive: boolean;
  was_fired_round: number | null;
  private_state: {
    known_alignments: Record<string, Alignment>;
    action_results: ActionResult[];
  };
  joined_at: string;
  last_active_at: string;
  left_at: string | null;
  is_online: boolean;
}

export interface SeasonState {
  room_id: string;
  board_pressure: number;
  integrity_pressure: number;
  sporting_pressure: number;
  consecutive_dnfs: number;
  board_threshold: number;
  integrity_threshold: number;
  sporting_threshold: number;
  season_rules: Record<string, any>;
  updated_at: string;
}

export interface Race {
  id: string;
  room_id: string;
  round_number: number;
  track_name: string;
  track_id: string | null;
  weather_tags: string[];
  risk_modifier: number;
  round_seed: string;
  driver_1_dnf: boolean | null;
  driver_2_dnf: boolean | null;
  driver_1_performance: number | null;
  driver_2_performance: number | null;
  public_report: string | null;
  result_state: Record<string, any>;
  created_at: string;
}

export interface Action {
  id: string;
  room_id: string;
  round_number: number;
  player_id: string;
  action_type: ActionType;
  action_target: string | null;
  resolved: boolean;
  resolved_result: Record<string, any> | null;
  created_at: string;
}

export interface Vote {
  id: string;
  room_id: string;
  round_number: number;
  voter_player_id: string;
  target_player_id: string;
  created_at: string;
}

export interface Message {
  id: string;
  room_id: string;
  round_number: number;
  author_player_id: string;
  content: string;
  generated_by_bot: boolean;
  visibility: string;
  created_at: string;
}

export interface ActionResult {
  round: number;
  type: string;
  success: boolean;
  details: string;
}

export interface BotPersonality {
  aggression: number;
  trust_bias: number;
  accusation_threshold: number;
  reveal_threshold: number;
}

export interface BotMemory {
  bot_player_id: string;
  room_id: string;
  suspicion_scores: Record<string, number>;
  trust_scores: Record<string, number>;
  phrase_cooldowns: Record<string, number>;
  vote_history: VoteRecord[];
  claim_history: ClaimRecord[];
  memory_state: Record<string, any>;
  updated_at: string;
}

export interface VoteRecord {
  round: number;
  target: string;
  reason: string;
}

export interface ClaimRecord {
  round: number;
  player: string;
  claim_type: string;
  content: string;
}
