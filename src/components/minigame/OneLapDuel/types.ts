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
  focused_skills: string[]; // e.g. ['acceleration', 'braking']
}

export type TrackNode = {
  id: number;
  type: 'straight' | 'turn';
  length: number; // meters
  base_speed_entry: number; // km/h
  base_speed_exit: number; // km/h
  drag_factor: number; // 1.0 = standard
  overtake_difficulty: number; // 0-1 (1 = hard)
  name_key: string;
  start_dist?: number; // Calculated at runtime
  end_dist?: number;   // Calculated at runtime
};

export type ERSMode = 'neutral' | 'hotlap' | 'overtake' | 'recharge';
export type RacingLine = 'clean' | 'defense' | 'opportunity';

export interface RaceState {
    time: number; // Current race time in seconds
    p1: {
        distance: number; // Meters traveled
        speed: number;    // km/h
        battery: number;  // %
        last_node_id: number;
        lateral_offset: number; // -1 (Inside) to 1 (Outside)
        target_offset?: number;
        reaction_end_time?: number;
    };
    p2: {
        distance: number;
        speed: number;
        battery: number;
        last_node_id: number;
        lateral_offset: number;
        target_offset?: number;
        reaction_end_time?: number;
    };
    starting_grid?: {
        p1: number; // 1 or 2
        p2: number; // 1 or 2
    };
    finished: boolean;
    winner_id: string | null;
    logs: any[]; // For replay/history
}

export type PlayerStrategy = {
    ers_per_node: Record<number, ERSMode>;
    line_per_node: Record<number, RacingLine>;
    current_ers: ERSMode; // Real-time
    current_line: RacingLine; // Real-time
};

// Mock Track (Monza-ish)
export const MONZA_TRACK: TrackNode[] = [
  { id: 0, type: 'straight', length: 1100, base_speed_entry: 200, base_speed_exit: 330, drag_factor: 1.0, overtake_difficulty: 0.2, name_key: 'main_straight' },
  { id: 1, type: 'turn', length: 150, base_speed_entry: 330, base_speed_exit: 80, drag_factor: 1.2, overtake_difficulty: 0.8, name_key: 'variante_del_rettifilo' },
  { id: 2, type: 'turn', length: 300, base_speed_entry: 80, base_speed_exit: 280, drag_factor: 1.0, overtake_difficulty: 0.5, name_key: 'curva_grande' },
  { id: 3, type: 'turn', length: 150, base_speed_entry: 280, base_speed_exit: 160, drag_factor: 1.1, overtake_difficulty: 0.7, name_key: 'variante_della_roggia' },
  { id: 4, type: 'turn', length: 100, base_speed_entry: 160, base_speed_exit: 180, drag_factor: 1.1, overtake_difficulty: 0.6, name_key: 'lesmo_1' },
  { id: 5, type: 'turn', length: 100, base_speed_entry: 180, base_speed_exit: 170, drag_factor: 1.1, overtake_difficulty: 0.6, name_key: 'lesmo_2' },
  { id: 6, type: 'straight', length: 900, base_speed_entry: 170, base_speed_exit: 320, drag_factor: 1.0, overtake_difficulty: 0.3, name_key: 'serraglio_straight' },
  { id: 7, type: 'turn', length: 200, base_speed_entry: 320, base_speed_exit: 190, drag_factor: 1.2, overtake_difficulty: 0.7, name_key: 'variante_ascari' },
  { id: 8, type: 'straight', length: 800, base_speed_entry: 190, base_speed_exit: 330, drag_factor: 1.0, overtake_difficulty: 0.2, name_key: 'back_straight' },
  { id: 9, type: 'turn', length: 250, base_speed_entry: 330, base_speed_exit: 200, drag_factor: 1.1, overtake_difficulty: 0.5, name_key: 'parabolica' },
];

export const SPA_TRACK: TrackNode[] = [
  { id: 0, type: 'turn', length: 100, base_speed_entry: 250, base_speed_exit: 60, drag_factor: 1.2, overtake_difficulty: 0.9, name_key: 'la_source' },
  { id: 1, type: 'straight', length: 500, base_speed_entry: 60, base_speed_exit: 280, drag_factor: 1.0, overtake_difficulty: 0.3, name_key: 'eau_rouge_app' },
  { id: 2, type: 'turn', length: 300, base_speed_entry: 280, base_speed_exit: 300, drag_factor: 1.1, overtake_difficulty: 0.8, name_key: 'raidillon' },
  { id: 3, type: 'straight', length: 1500, base_speed_entry: 300, base_speed_exit: 330, drag_factor: 0.9, overtake_difficulty: 0.1, name_key: 'kemmel_straight' },
  { id: 4, type: 'turn', length: 200, base_speed_entry: 330, base_speed_exit: 140, drag_factor: 1.1, overtake_difficulty: 0.6, name_key: 'les_combes' },
  { id: 5, type: 'turn', length: 150, base_speed_entry: 140, base_speed_exit: 120, drag_factor: 1.1, overtake_difficulty: 0.7, name_key: 'malmedy' },
  { id: 6, type: 'turn', length: 250, base_speed_entry: 120, base_speed_exit: 100, drag_factor: 1.1, overtake_difficulty: 0.7, name_key: 'rivage' },
  { id: 7, type: 'turn', length: 200, base_speed_entry: 100, base_speed_exit: 160, drag_factor: 1.0, overtake_difficulty: 0.5, name_key: 'pouhon' },
  { id: 8, type: 'straight', length: 800, base_speed_entry: 160, base_speed_exit: 290, drag_factor: 1.0, overtake_difficulty: 0.3, name_key: 'blanchimont_app' },
  { id: 9, type: 'turn', length: 150, base_speed_entry: 290, base_speed_exit: 80, drag_factor: 1.2, overtake_difficulty: 0.9, name_key: 'bus_stop' },
];

export const SILVERSTONE_TRACK: TrackNode[] = [
  { id: 0, type: 'turn', length: 150, base_speed_entry: 280, base_speed_exit: 250, drag_factor: 1.0, overtake_difficulty: 0.4, name_key: 'abbey' },
  { id: 1, type: 'turn', length: 200, base_speed_entry: 250, base_speed_exit: 100, drag_factor: 1.1, overtake_difficulty: 0.7, name_key: 'village' },
  { id: 2, type: 'straight', length: 600, base_speed_entry: 100, base_speed_exit: 290, drag_factor: 1.0, overtake_difficulty: 0.2, name_key: 'wellington_straight' },
  { id: 3, type: 'turn', length: 150, base_speed_entry: 290, base_speed_exit: 110, drag_factor: 1.1, overtake_difficulty: 0.8, name_key: 'brooklands' },
  { id: 4, type: 'turn', length: 100, base_speed_entry: 110, base_speed_exit: 180, drag_factor: 1.0, overtake_difficulty: 0.5, name_key: 'woodcote' },
  { id: 5, type: 'straight', length: 400, base_speed_entry: 180, base_speed_exit: 280, drag_factor: 1.0, overtake_difficulty: 0.3, name_key: 'copse_app' },
  { id: 6, type: 'turn', length: 150, base_speed_entry: 280, base_speed_exit: 260, drag_factor: 1.0, overtake_difficulty: 0.6, name_key: 'copse' },
  { id: 7, type: 'turn', length: 400, base_speed_entry: 260, base_speed_exit: 240, drag_factor: 1.1, overtake_difficulty: 0.8, name_key: 'maggotts_becketts' },
  { id: 8, type: 'straight', length: 800, base_speed_entry: 240, base_speed_exit: 310, drag_factor: 1.0, overtake_difficulty: 0.1, name_key: 'hangar_straight' },
  { id: 9, type: 'turn', length: 200, base_speed_entry: 310, base_speed_exit: 130, drag_factor: 1.1, overtake_difficulty: 0.7, name_key: 'stowe' },
];

export const TRACKS: Record<string, TrackNode[]> = {
    'monza': MONZA_TRACK,
    'spa': SPA_TRACK,
    'silverstone': SILVERSTONE_TRACK
};

export const INITIAL_BATTERY = 100; // %
