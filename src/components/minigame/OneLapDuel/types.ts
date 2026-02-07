export interface DriverStats {
  user_id: string;
  acceleration_skill: number;
  braking_skill: number;
  cornering_skill: number;
  ers_efficiency_skill: number;
  decision_making_skill: number;
  morale: number; // 0-100
  daily_dev_accumulated: number;
  last_training_update: string;
  training_mode: 'rest' | 'light' | 'intense';
}

export type TrackNode = {
  id: number;
  type: 'straight' | 'turn';
  length: number; // meters
  base_speed_entry: number; // km/h
  base_speed_exit: number; // km/h
  drag_factor: number; // 1.0 = standard
  overtake_difficulty: number; // 0-1 (1 = hard)
  name?: string;
};

export type ERSMode = 'neutral' | 'recharge' | 'hotlap' | 'overtake';
export type RacingLine = 'clean' | 'defense' | 'opportunity';

export type PlayerStrategy = {
  ers_per_node: Record<number, ERSMode>;
  line_per_node: Record<number, RacingLine>;
};

export type RaceState = {
  distance: number;
  speed: number;
  battery: number; // 0-100%
  current_time: number;
  gap_to_leader: number; // seconds (if 2nd)
  position: 1 | 2;
  logs: string[];
};

export type RaceResult = {
  winner_id: string;
  total_time_p1: number;
  total_time_p2: number;
  logs: any[]; // detailed logs for replay
};

// Mock Track (Monza-ish)
export const MONZA_TRACK: TrackNode[] = [
  { id: 0, type: 'straight', length: 1100, base_speed_entry: 200, base_speed_exit: 330, drag_factor: 1.0, overtake_difficulty: 0.2, name: 'Main Straight' },
  { id: 1, type: 'turn', length: 150, base_speed_entry: 330, base_speed_exit: 80, drag_factor: 1.2, overtake_difficulty: 0.8, name: 'Variante del Rettifilo' },
  { id: 2, type: 'turn', length: 300, base_speed_entry: 80, base_speed_exit: 280, drag_factor: 1.0, overtake_difficulty: 0.5, name: 'Curva Grande' },
  { id: 3, type: 'turn', length: 150, base_speed_entry: 280, base_speed_exit: 160, drag_factor: 1.1, overtake_difficulty: 0.7, name: 'Variante della Roggia' },
  { id: 4, type: 'turn', length: 100, base_speed_entry: 160, base_speed_exit: 180, drag_factor: 1.1, overtake_difficulty: 0.6, name: 'Lesmo 1' },
  { id: 5, type: 'turn', length: 100, base_speed_entry: 180, base_speed_exit: 170, drag_factor: 1.1, overtake_difficulty: 0.6, name: 'Lesmo 2' },
  { id: 6, type: 'straight', length: 900, base_speed_entry: 170, base_speed_exit: 320, drag_factor: 1.0, overtake_difficulty: 0.3, name: 'Serraglio Straight' },
  { id: 7, type: 'turn', length: 200, base_speed_entry: 320, base_speed_exit: 190, drag_factor: 1.2, overtake_difficulty: 0.7, name: 'Variante Ascari' },
  { id: 8, type: 'straight', length: 800, base_speed_entry: 190, base_speed_exit: 330, drag_factor: 1.0, overtake_difficulty: 0.2, name: 'Back Straight' },
  { id: 9, type: 'turn', length: 250, base_speed_entry: 330, base_speed_exit: 200, drag_factor: 1.1, overtake_difficulty: 0.5, name: 'Parabolica' },
];

export const INITIAL_BATTERY = 100; // %
