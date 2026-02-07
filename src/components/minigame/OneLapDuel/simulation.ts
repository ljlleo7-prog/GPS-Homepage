import { DriverStats, ERSMode, INITIAL_BATTERY, PlayerStrategy, RacingLine, TrackNode, RaceState } from './types';

export type SimulationEvent = {
  type: 'defense_success' | 'overtake_chance';
  leader: 'p1' | 'p2';
  chaser: 'p1' | 'p2';
};

export type SimulationLog = {
  time: number; // Global Race Time
  nodeId: number; // Current/Last node
  p1_dist: number;
  p2_dist: number;
  p1_speed: number;
  p2_speed: number;
  p1_battery: number;
  p2_battery: number;
  gap: number; // Distance Gap in Meters
  events: SimulationEvent[];
};

export type SimulationResult = {
  winner_id: string;
  p1_total_time: number;
  p2_total_time: number;
  logs: SimulationLog[];
};

// Helper to get random factor based on morale and decision skill
const getRandomFactor = (morale: number, decisionSkill: number) => {
  const moraleFactor = 1 + (100 - morale) / 200; // 1.0 to 1.5 variance
  const baseRandom = (Math.random() - 0.5) * 2; // -1 to 1
  const skillBias = decisionSkill / 100; // 0.0 to 0.2
  return (baseRandom * 0.02 * moraleFactor) + skillBias; // Reduced random noise for stability
};

const calculatePhysics = (
  baseSpeed: number, // Target speed for this section
  driver: DriverStats,
  ers: ERSMode,
  line: RacingLine,
  node: TrackNode,
  currentBattery: number,
  currentSpeed: number // Current speed of car
): { speed: number; batteryChange: number } => {
  let targetSpeed = baseSpeed;
  
  // 1. Driver Skills
  const skillFactor = node.type === 'straight' 
    ? (driver.acceleration_skill / 100) 
    : (driver.cornering_skill / 100);
  targetSpeed *= (1 + (skillFactor * 0.1)); // Max 10% bonus from skills

  // 2. Battery Physics (New Realistic Model)
  // Braking (Entry to Turn): Charge
  // Straight: Drain (if ERS used)
  // Rate determined by Mode
  
  let batteryChange = 0;
  const efficiency = 1 + (driver.ers_efficiency_skill / 100); // 1.0 - 1.2

  if (node.type === 'turn') {
      // Natural Braking / Coasting Charge
      // ERS Mode affects how much we harvest vs maintain momentum
      if (ers === 'recharge') {
          batteryChange = 1.5 * efficiency; // High harvest
          targetSpeed *= 0.90; // Slower cornering
      } else if (ers === 'neutral') {
          batteryChange = 0.5 * efficiency; // Light harvest
      } else {
          batteryChange = -0.2; // Deploying in corner (bad idea usually)
          targetSpeed *= 1.02;
      }
  } else {
      // Straight - Deployment
      if (currentBattery > 0) {
          if (ers === 'hotlap') {
              batteryChange = -1.2 / efficiency; // High drain
              targetSpeed *= 1.15; // Big boost
          } else if (ers === 'overtake') {
              batteryChange = -2.0 / efficiency; // Massive drain
              targetSpeed *= 1.25; // Huge boost
          } else if (ers === 'neutral') {
              batteryChange = -0.1 / efficiency; // Minimal usage to maintain systems
          } else if (ers === 'recharge') {
              batteryChange = 0.5 * efficiency; // Lift and coast on straight?
              targetSpeed *= 0.85;
          }
      } else {
          targetSpeed *= 0.90; // Penalty for dead battery
      }
  }

  // 3. Line Choice
  if (line === 'defense') {
    targetSpeed *= 0.95; 
  } else if (line === 'opportunity') {
    targetSpeed *= 0.98; // Slightly slower unless overtaking (handled in interaction)
  }

  // 4. Random/Morale
  const noise = getRandomFactor(driver.morale, driver.decision_making_skill);
  targetSpeed *= (1 + noise);

  // Smooth Speed Transition (Inertia)
  // We don't jump instantly to target speed. We accelerate/brake towards it.
  const acceleration = node.type === 'straight' ? 20 : 10; // km/h per tick
  let newSpeed = currentSpeed;
  if (currentSpeed < targetSpeed) {
      newSpeed = Math.min(targetSpeed, currentSpeed + acceleration);
  } else {
      newSpeed = Math.max(targetSpeed, currentSpeed - acceleration * 2); // Braking is faster
  }

  return { speed: newSpeed, batteryChange };
};

export const getInitialRaceState = (track: TrackNode[]): RaceState => {
    // Calculate accumulated distances for quick lookup
    let dist = 0;
    track.forEach(node => {
        node.start_dist = dist;
        dist += node.length;
        node.end_dist = dist;
    });

    return {
        time: 0,
        p1: { distance: 0, speed: 100, battery: INITIAL_BATTERY, last_node_id: 0 },
        p2: { distance: 0, speed: 100, battery: INITIAL_BATTERY, last_node_id: 0 },
        finished: false,
        winner_id: null,
        logs: []
    };
};

export const advanceRaceState = (
    prevState: RaceState,
    p1: { driver: DriverStats; strategy: PlayerStrategy; id: string },
    p2: { driver: DriverStats; strategy: PlayerStrategy; id: string },
    track: TrackNode[]
): RaceState => {
    const newState = JSON.parse(JSON.stringify(prevState)); // Deep copy
    newState.time += 1; // 1 second tick

    const trackLength = track[track.length - 1].end_dist!;

    // Helper to find node
    const getNode = (dist: number) => track.find(n => dist >= n.start_dist! && dist < n.end_dist!) || track[track.length-1];

    const p1Node = getNode(newState.p1.distance);
    const p2Node = getNode(newState.p2.distance);

    newState.p1.last_node_id = p1Node.id;
    newState.p2.last_node_id = p2Node.id;

    // Calculate Physics
    const p1Phys = calculatePhysics(
        p1Node.base_speed_exit, // Aiming for exit speed
        p1.driver,
        p1.strategy.current_ers,
        p1.strategy.current_line,
        p1Node,
        newState.p1.battery,
        newState.p1.speed
    );

    const p2Phys = calculatePhysics(
        p2Node.base_speed_exit,
        p2.driver,
        p2.strategy.current_ers,
        p2.strategy.current_line,
        p2Node,
        newState.p2.battery,
        newState.p2.speed
    );

    // Interaction Logic (Overtaking)
    // Check if they are close in distance
    const distGap = newState.p1.distance - newState.p2.distance; // +ve P1 ahead
    const events: SimulationEvent[] = [];

    // Interaction only if within 20 meters
    if (Math.abs(distGap) < 20) {
        const leader = distGap > 0 ? 'p1' : 'p2';
        const chaser = distGap > 0 ? 'p2' : 'p1';
        const leaderStrat = leader === 'p1' ? p1.strategy : p2.strategy;
        const chaserStrat = chaser === 'p1' ? p1.strategy : p2.strategy;

        if (leaderStrat.current_line === 'defense') {
             if (chaserStrat.current_line === 'opportunity') {
                 // Blocked!
                 if (chaser === 'p2') p2Phys.speed *= 0.90;
                 else p1Phys.speed *= 0.90;
                 events.push({ type: 'defense_success', leader, chaser });
             } else {
                 // Stuck behind
                 if (chaser === 'p2') p2Phys.speed = Math.min(p2Phys.speed, p1Phys.speed);
                 else p1Phys.speed = Math.min(p1Phys.speed, p2Phys.speed);
             }
        } else if (leaderStrat.current_line === 'clean') {
             if (chaserStrat.current_line === 'opportunity') {
                 // Overtake boost!
                 if (chaser === 'p2') p2Phys.speed *= 1.10;
                 else p1Phys.speed *= 1.10;
                 events.push({ type: 'overtake_chance', leader, chaser });
             }
        }
    }

    // Apply State Changes
    newState.p1.speed = p1Phys.speed;
    newState.p1.battery = Math.max(0, Math.min(100, newState.p1.battery + p1Phys.batteryChange));
    // Dist += Speed (km/h) * Time (1s) * 1000 / 3600
    newState.p1.distance += (newState.p1.speed * 1000 / 3600);

    newState.p2.speed = p2Phys.speed;
    newState.p2.battery = Math.max(0, Math.min(100, newState.p2.battery + p2Phys.batteryChange));
    newState.p2.distance += (newState.p2.speed * 1000 / 3600);

    // Log
    newState.logs.push({
        time: newState.time,
        nodeId: p1Node.id, // Reference P1 for UI
        p1_dist: newState.p1.distance,
        p2_dist: newState.p2.distance,
        p1_speed: newState.p1.speed,
        p2_speed: newState.p2.speed,
        p1_battery: newState.p1.battery,
        p2_battery: newState.p2.battery,
        gap: distGap, // Meters
        events
    });

    // Check Finish
    if (newState.p1.distance >= trackLength || newState.p2.distance >= trackLength) {
        newState.finished = true;
        newState.winner_id = newState.p1.distance > newState.p2.distance ? p1.id : p2.id;
    }

    return newState;
};

// Deprecated: Old Node-based sim (kept for type safety if needed temporarily)
export const simulateRace = (p1: any, p2: any, track: any) => { return { winner_id: '', logs: [] } };