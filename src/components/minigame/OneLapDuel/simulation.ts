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

// --- Physics Constants (2026 Regulations) ---
const MASS = 768; // kg (Min weight)
const AIR_DENSITY = 1.225; // kg/m^3
const GRAVITY = 9.81;

// Aerodynamics (Active Aero)
const DRAG_AREA_Z_MODE = 1.2; // High Downforce (Corners) - ~30% less downforce than 2022
const DRAG_AREA_X_MODE = 0.7; // Low Drag (Straights) - ~40-55% less drag
const ROLLING_RESISTANCE_COEFF = 0.015;

// Power Maps (Watts) - 2026 Regs: ~400kW ICE + 350kW ERS
const BASE_ENGINE_POWER = 400000; // 400 kW ICE
const ERS_POWER_MAP: Record<ERSMode, number> = {
    'neutral': 100000,  // +100 kW (Standard deployment)
    'hotlap': 250000,   // +250 kW (Aggressive)
    'overtake': 350000, // +350 kW (Manual Override / Max Boost)
    'recharge': 0       // 0 kW (ICE only, harvesting via braking/lift)
};

// Battery Usage (Percent per second at max load)
// 350kW drain is massive. Assuming ~4MJ usable per lap equivalent capacity.
// 4MJ / 350kW = ~11.4 seconds of full boost per lap.
const ERS_DRAIN_RATE: Record<ERSMode, number> = {
    'neutral': 2.0,   // Sustainable-ish
    'hotlap': 5.0,    // Fast drain
    'overtake': 9.0,  // Very fast drain (~11s total capacity)
    'recharge': -2.0  // Passive regen (Lift & Coast behavior simulation)
};

// Helper to get random factor based on morale and decision skill
const getRandomFactor = (morale: number, decisionSkill: number) => {
  const moraleFactor = 1 + (100 - morale) / 500; // Reduced variance
  const baseRandom = (Math.random() - 0.5) * 2; // -1 to 1
  const skillBias = decisionSkill / 100; // 0.0 to 0.2 (Unused for now in pure physics, used in overtaking)
  return (baseRandom * 0.01 * moraleFactor); // Very small noise
};

interface PhysicsState {
    speed: number; // m/s
    battery: number; // %
    lateral_offset: number; // -1 to 1
}

const calculatePhysicsStep = (
  dt: number, // seconds
  currentState: PhysicsState,
  node: TrackNode,
  nextNode: TrackNode,
  distInNode: number, // Distance traveled within current node
  driver: DriverStats,
  ers: ERSMode,
  line: RacingLine
): PhysicsState => {
  let { speed, battery, lateral_offset } = currentState; // speed is m/s
  
  // 1. Determine Target Line & Lateral Movement
  let targetOffset = 0;
  if (line === 'defense') targetOffset = -0.8;
  if (line === 'opportunity') targetOffset = 0.8;
  
  // Smoothly transition lateral offset
  const lateralSpeed = 0.5 * dt; // Move 0.5 units per second
  if (lateral_offset < targetOffset) lateral_offset = Math.min(targetOffset, lateral_offset + lateralSpeed);
  else if (lateral_offset > targetOffset) lateral_offset = Math.max(targetOffset, lateral_offset - lateralSpeed);

  // 2. Active Aero Logic
  // X-Mode (Low Drag) enabled on straights (node.type === 'straight')
  // Z-Mode (High Downforce) in corners
  const isActiveAeroXMode = node.type === 'straight';
  const currentDragArea = isActiveAeroXMode ? DRAG_AREA_X_MODE : DRAG_AREA_Z_MODE;

  // 3. Determine Max Speed for Current Context
  // Are we braking for the NEXT corner?
  const distToNextNode = node.length - distInNode;
  const brakingDistNeeded = (speed * speed - (nextNode.base_speed_entry / 3.6) ** 2) / (2 * 4.5 * GRAVITY); // v^2 = u^2 + 2as -> s = (v^2 - u^2)/2a
  
  let targetSpeedLimit = 1000; // Infinite on straight
  let brakingMode = false;

  // Check if we need to brake for the next node
  if (distToNextNode < brakingDistNeeded + 20 && nextNode.base_speed_entry < (speed * 3.6)) {
      targetSpeedLimit = nextNode.base_speed_entry / 3.6;
      brakingMode = true;
  } 
  // Or are we in a turn constrained by grip?
  else if (node.type === 'turn') {
      let cornerSpeed = node.base_speed_entry / 3.6; // Base corner speed
      
      // Line effects on corner speed
      if (line === 'defense') cornerSpeed *= 0.92; // Tight line, slower
      else if (line === 'opportunity') cornerSpeed *= 1.05; // Wide entry, faster exit
      
      // Skill effects
      cornerSpeed *= (1 + (driver.cornering_skill / 2000)); // Small boost
      
      // Active Aero Z-Mode helps cornering speed (implicit in base_speed, but we can boost slightly for 2026 active wings)
      // Actually 2026 has LESS downforce, so corner speeds might be lower than 2022.
      // We assume base_speed_entry is calibrated for "Standard F1", so maybe we reduce it slightly?
      // Let's keep it as is for gameplay balance.
      
      targetSpeedLimit = cornerSpeed;
  }

  // 4. Calculate Forces
  const dragForce = 0.5 * AIR_DENSITY * currentDragArea * speed * speed;
  const rollingRes = ROLLING_RESISTANCE_COEFF * MASS * GRAVITY;
  
  let netForce = 0;
  let batteryChange = 0;

  // Braking Logic
  if (speed > targetSpeedLimit || brakingMode) {
      // BRAKING
      const maxBrakingForce = 4.5 * MASS * GRAVITY * (1 + driver.braking_skill/500); // ~4.5G braking
      const neededBrakingForce = (MASS * (speed - targetSpeedLimit)) / dt; // Simple P-controller
      const brakingForce = Math.min(maxBrakingForce, neededBrakingForce + dragForce); // Use drag to help
      
      netForce = -brakingForce;
      
      // MGU-K Harvesting (Regen)
      // 350kW max regen allowed in 2026
      const regenPowerMax = 350000; 
      // How much of braking force is from Regen vs Friction?
      // Typically rear braking is almost all Regen until limit.
      const brakingPower = brakingForce * speed;
      const regenPower = Math.min(regenPowerMax, brakingPower);
      
      // Convert Regen Power to Battery %
      // 350kW for 1 sec = 350kJ. 
      // If 100% battery = ~4MJ? (approx capacity)
      // Then 350kJ is ~8.75% charge per second at max regen.
      const regenPercentage = (regenPower / 350000) * 8.75 * dt; 
      batteryChange += regenPercentage;

  } else {
      // ACCELERATING / MAINTAINING
      let availablePower = BASE_ENGINE_POWER; // 400kW ICE
      
      // ERS Boost
      if (battery > 0) {
          availablePower += ERS_POWER_MAP[ers];
          batteryChange -= ERS_DRAIN_RATE[ers] * dt;
      }
      
      // Skill modifier on power application (traction control)
      availablePower *= (1 + driver.acceleration_skill / 2000);

      // Force = Power / Velocity
      // Clamp velocity to avoid infinity at 0 speed
      const effectiveSpeed = Math.max(10, speed); 
      const engineForce = availablePower / effectiveSpeed;
      
      netForce = engineForce - dragForce - rollingRes;
  }

  // 5. Apply Physics Integration (Euler)
  const acceleration = netForce / MASS;
  speed += acceleration * dt;
  
  // Cap speed at 0 (no reversing)
  speed = Math.max(0, speed);

  // 6. Battery Limits
  battery = Math.max(0, Math.min(100, battery + batteryChange));

  return { speed, battery, lateral_offset };
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
        p1: { distance: 0, speed: 0, battery: INITIAL_BATTERY, last_node_id: 0, lateral_offset: 0 },
        p2: { distance: 0, speed: 0, battery: INITIAL_BATTERY, last_node_id: 0, lateral_offset: 0 },
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
    const DT = 1.0; // Delta Time

    const trackLength = track[track.length - 1].end_dist!;

    // Helper to find node
    const getNode = (dist: number) => track.find(n => dist >= n.start_dist! && dist < n.end_dist!) || track[track.length-1];
    const getNextNode = (node: TrackNode) => track[(track.indexOf(node) + 1) % track.length];

    const p1Node = getNode(newState.p1.distance);
    const p2Node = getNode(newState.p2.distance);

    newState.p1.last_node_id = p1Node.id;
    newState.p2.last_node_id = p2Node.id;

    // --- Physics Simulation (Sub-stepping for accuracy) ---
    const SUB_STEPS = 10;
    const SUB_DT = DT / SUB_STEPS;

    // Initialize temp physics state
    let p1State = { 
        speed: newState.p1.speed / 3.6, 
        battery: newState.p1.battery, 
        lateral_offset: newState.p1.lateral_offset || 0,
        distance: newState.p1.distance
    };
    let p2State = { 
        speed: newState.p2.speed / 3.6, 
        battery: newState.p2.battery, 
        lateral_offset: newState.p2.lateral_offset || 0,
        distance: newState.p2.distance
    };

    for (let i = 0; i < SUB_STEPS; i++) {
        // P1 Step
        const p1NodeCurrent = getNode(p1State.distance);
        const p1NextCurrent = getNextNode(p1NodeCurrent);
        const p1Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p1State.speed, battery: p1State.battery, lateral_offset: p1State.lateral_offset }, 
            p1NodeCurrent, p1NextCurrent, p1State.distance - p1NodeCurrent.start_dist!, 
            p1.driver, p1.strategy.current_ers, p1.strategy.current_line
        );
        p1State.speed = p1Res.speed;
        p1State.battery = p1Res.battery;
        p1State.lateral_offset = p1Res.lateral_offset;
        p1State.distance += p1State.speed * SUB_DT;

        // P2 Step
        const p2NodeCurrent = getNode(p2State.distance);
        const p2NextCurrent = getNextNode(p2NodeCurrent);
        const p2Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p2State.speed, battery: p2State.battery, lateral_offset: p2State.lateral_offset }, 
            p2NodeCurrent, p2NextCurrent, p2State.distance - p2NodeCurrent.start_dist!, 
            p2.driver, p2.strategy.current_ers, p2.strategy.current_line
        );
        p2State.speed = p2Res.speed;
        p2State.battery = p2Res.battery;
        p2State.lateral_offset = p2Res.lateral_offset;
        p2State.distance += p2State.speed * SUB_DT;
    }

    // Apply Final State
    newState.p1.speed = p1State.speed * 3.6; // m/s to km/h
    newState.p1.battery = p1State.battery;
    newState.p1.lateral_offset = p1State.lateral_offset;
    newState.p1.distance = p1State.distance;
    
    newState.p2.speed = p2State.speed * 3.6;
    newState.p2.battery = p2State.battery;
    newState.p2.lateral_offset = p2State.lateral_offset;
    newState.p2.distance = p2State.distance;

    // --- Interaction Logic (Overtaking & Dirty Air) ---
    const distGap = newState.p1.distance - newState.p2.distance; // +ve P1 ahead
    const events: SimulationEvent[] = [];

    // Interaction Check (DRS / Slipstream / Blocking)
    if (Math.abs(distGap) < 15) { // Within 15 meters
        const leader = distGap > 0 ? 'p1' : 'p2';
        const chaser = distGap > 0 ? 'p2' : 'p1';
        const leaderState = leader === 'p1' ? newState.p1 : newState.p2;
        const chaserState = chaser === 'p1' ? newState.p1 : newState.p2;

        // Slipstream Effect (Always active if close)
        // Reduces drag for chaser -> higher acceleration
        // Simplified: boost speed slightly
        chaserState.speed *= 1.02; // +2% speed from slipstream

        // Blocking Logic
        // If leader is defending (offset < -0.5) and chaser is trying to pass on inside?
        // Or simplified: if lateral offsets are close, chaser is blocked
        if (Math.abs(leaderState.lateral_offset - chaserState.lateral_offset) < 0.5) {
            // Blocked! Chaser cannot exceed leader speed significantly
            if (chaserState.speed > leaderState.speed) {
                 chaserState.speed = leaderState.speed; // Match speed (brake check / stuck)
                 events.push({ type: 'defense_success', leader, chaser });
            }
        } else {
             // Side by side or clear air
             if (chaserState.speed > leaderState.speed * 1.05) {
                 events.push({ type: 'overtake_chance', leader, chaser });
             }
        }
    }

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
