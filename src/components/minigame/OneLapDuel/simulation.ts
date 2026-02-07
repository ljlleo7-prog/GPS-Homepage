import { DriverStats, ERSMode, INITIAL_BATTERY, MONZA_TRACK, PlayerStrategy, RacingLine, TrackNode } from './types';

export type SimulationLog = {
  nodeId: number;
  nodeName: string;
  p1_time: number;
  p2_time: number;
  p1_speed: number;
  p2_speed: number;
  p1_battery: number;
  p2_battery: number;
  gap: number; // + means P1 ahead, - means P2 ahead (relative to track position, but we simplify to time gap)
  events: string[];
};

export type SimulationResult = {
  winner_id: string;
  p1_total_time: number;
  p2_total_time: number;
  logs: SimulationLog[];
};

// Helper to get random factor based on morale and decision skill
// Morale 0-100: Low morale = higher variance. High morale = lower variance.
// Decision 0-20: High skill = positive skew.
const getRandomFactor = (morale: number, decisionSkill: number) => {
  const moraleFactor = 1 + (100 - morale) / 200; // 1.0 to 1.5 variance
  const baseRandom = (Math.random() - 0.5) * 2; // -1 to 1
  const skillBias = decisionSkill / 100; // 0.0 to 0.2
  
  // Result is roughly -0.1 to +0.1 speed modifier (10%)
  return (baseRandom * 0.05 * moraleFactor) + skillBias;
};

const calculateSpeed = (
  baseSpeed: number,
  driver: DriverStats,
  ers: ERSMode,
  line: RacingLine,
  node: TrackNode,
  currentBattery: number
): { speed: number; batteryCost: number } => {
  let speed = baseSpeed;
  let batteryCost = 0;

  // 1. Driver Skills (0-20 scale expected, normalizing to 0.9 - 1.1 multiplier)
  // Acceleration helps on straights (exit speed)
  // Cornering helps on turns (apex/entry)
  // Braking helps on turn entry
  const skillFactor = node.type === 'straight' 
    ? (driver.acceleration_skill / 100) 
    : (driver.cornering_skill / 100);
  
  speed *= (1 + skillFactor); // +0% to +20%

  // 2. ERS
  // Efficiency modifies cost and boost
  const efficiency = 1 + (driver.ers_efficiency_skill / 200) + (driver.morale / 1000); // 1.0 - 1.2
  
  if (currentBattery > 5) {
    if (ers === 'hotlap') {
      speed *= 1.05; // 5% boost
      batteryCost = 15 / efficiency;
    } else if (ers === 'overtake') {
      speed *= 1.08; // 8% boost
      batteryCost = 25 / efficiency;
    } else if (ers === 'neutral') {
      batteryCost = 5 / efficiency; // Maintenance
    } else if (ers === 'recharge') {
      speed *= 0.95; // 5% slow
      batteryCost = -10 * efficiency; // Gain
    }
  } else {
    // Empty battery penalty
    speed *= 0.98;
  }

  // 3. Line Choice
  if (line === 'defense') {
    speed *= 0.97; // Slower line
  } else if (line === 'opportunity') {
    speed *= 0.99; // Risky, base is slightly slower unless overtaking
  }

  // 4. Random/Morale
  const noise = getRandomFactor(driver.morale, driver.decision_making_skill);
  speed *= (1 + noise);

  return { speed, batteryCost };
};

export const simulateRace = (
  p1: { id: string; driver: DriverStats; strategy: PlayerStrategy },
  p2: { id: string; driver: DriverStats; strategy: PlayerStrategy }
): SimulationResult => {
  let p1_time = 0;
  let p2_time = 0;
  let p1_battery = INITIAL_BATTERY;
  let p2_battery = INITIAL_BATTERY;
  let p1_dist = 0;
  let p2_dist = 0;
  
  // Who is physically ahead? We track time, but for interaction we need gap.
  // Gap = p2_time - p1_time. If +ve, P1 is faster (ahead in time/distance logic is tricky).
  // Let's treat them as running parallel ghosts and resolve interactions based on split times.
  
  const logs: SimulationLog[] = [];

  // Sort grid: Lower ranking/time starts ahead. Assuming P1 is passed as Pole Position.
  // We give P1 a tiny headstart or just start equal. Let's start equal.

  for (let i = 0; i < MONZA_TRACK.length; i++) {
    const node = MONZA_TRACK[i];
    const p1_strat_ers = p1.strategy.ers_per_node[node.id] || 'neutral';
    const p1_strat_line = p1.strategy.line_per_node[node.id] || 'clean';
    const p2_strat_ers = p2.strategy.ers_per_node[node.id] || 'neutral';
    const p2_strat_line = p2.strategy.line_per_node[node.id] || 'clean';

    // Calculate raw performance
    const p1_perf = calculateSpeed(node.base_speed_exit, p1.driver, p1_strat_ers, p1_strat_line, node, p1_battery);
    const p2_perf = calculateSpeed(node.base_speed_exit, p2.driver, p2_strat_ers, p2_strat_line, node, p2_battery);

    // Interaction Logic (Overtaking/Defense)
    // Current Gap entering this node (approximate based on accumulated time)
    const currentGap = p2_time - p1_time; // +ve means P2 is BEHIND P1 (took longer)
    const events: string[] = [];

    let p1_final_speed = p1_perf.speed;
    let p2_final_speed = p2_perf.speed;

    // If close (within 0.5s)
    if (Math.abs(currentGap) < 0.5) {
        const leader = currentGap > 0 ? 'p1' : 'p2';
        const chaser = currentGap > 0 ? 'p2' : 'p1';
        const leaderLine = leader === 'p1' ? p1_strat_line : p2_strat_line;
        const chaserLine = chaser === 'p1' ? p1_strat_line : p2_strat_line;

        if (leaderLine === 'defense') {
            if (chaserLine === 'opportunity') {
                // Defense vs Opportunity: Blocked!
                // Chaser loses speed
                if (chaser === 'p2') p2_final_speed *= 0.95;
                else p1_final_speed *= 0.95;
                events.push(`${leader.toUpperCase()} defends successfully against ${chaser.toUpperCase()}!`);
            } else {
                // Defense vs Clean: Leader slows down, Chaser might catch up but is stuck behind
                // No extra penalty, just the natural slowness of defense line
            }
        } else if (leaderLine === 'clean') {
            if (chaserLine === 'opportunity') {
                // Clean vs Opportunity: Overtake chance!
                // Chaser gets boost
                if (chaser === 'p2') p2_final_speed *= 1.05;
                else p1_final_speed *= 1.05;
                events.push(`${chaser.toUpperCase()} sees an opening on ${leader.toUpperCase()}!`);
            }
        }
    }

    // Update Battery
    p1_battery = Math.max(0, Math.min(100, p1_battery - p1_perf.batteryCost));
    p2_battery = Math.max(0, Math.min(100, p2_battery - p2_perf.batteryCost));

    // Calculate Node Time = Distance / Speed
    // Speed is km/h, Distance is m. 
    // Time (s) = (Dist / 1000) / (Speed / 3600) = Dist * 3.6 / Speed
    const p1_node_time = (node.length * 3.6) / p1_final_speed;
    const p2_node_time = (node.length * 3.6) / p2_final_speed;

    p1_time += p1_node_time;
    p2_time += p2_node_time;

    logs.push({
        nodeId: node.id,
        nodeName: node.name || `Turn ${node.id}`,
        p1_time: p1_time,
        p2_time: p2_time,
        p1_speed: p1_final_speed,
        p2_speed: p2_final_speed,
        p1_battery: p1_battery,
        p2_battery: p2_battery,
        gap: p2_time - p1_time,
        events
    });
  }

  return {
    winner_id: p1_time < p2_time ? p1.id : p2.id,
    p1_total_time: p1_time,
    p2_total_time: p2_time,
    logs
  };
};
