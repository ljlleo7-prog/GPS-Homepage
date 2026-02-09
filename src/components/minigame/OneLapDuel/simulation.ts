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
const DRAG_AREA_Z_MODE = 1.2; // High Downforce (Corners)
const DRAG_AREA_X_MODE = 0.7; // Low Drag (Straights)
const ROLLING_RESISTANCE_COEFF = 0.015;

// Power Maps (Watts)
const BASE_ENGINE_POWER = 400000; // 400 kW ICE
const ERS_POWER_MAP: Record<ERSMode, number> = {
    'neutral': 100000,
    'hotlap': 250000,
    'overtake': 350000,
    'recharge': 0
};

const ERS_DRAIN_RATE: Record<ERSMode, number> = {
    'neutral': 2.0,
    'hotlap': 5.0,
    'overtake': 9.0,
    'recharge': -2.0
};

interface PhysicsState {
    speed: number; // m/s
    battery: number; // %
    lateral_offset: number; // -1 to 1
}

export const calculatePhysicsStep = (
  dt: number, // seconds
  currentState: PhysicsState,
  node: TrackNode,
  nextNode: TrackNode,
  distInNode: number, // Distance traveled within current node
  driver: DriverStats,
  ers: ERSMode,
  line: RacingLine,
  targetOffset: number,
  ignoreNextNodeForBraking: boolean = false
): PhysicsState => {
  let { speed, battery, lateral_offset } = currentState; // speed is m/s
  
  // 1. Lateral Movement towards Target
  const baseLateralSpeed = 1.2;
  const decisionFactor = 0.8 + (driver.decision_making_skill / 25);
  const lineFactor = line === 'opportunity' ? 1.1 : line === 'defense' ? 0.9 : 1.0;
  const lateralSpeed = baseLateralSpeed * decisionFactor * lineFactor * dt;
  if (lateral_offset < targetOffset) lateral_offset = Math.min(targetOffset, lateral_offset + lateralSpeed);
  else if (lateral_offset > targetOffset) lateral_offset = Math.max(targetOffset, lateral_offset - lateralSpeed);

  // 2. Active Aero Logic
  const isActiveAeroXMode = node.type === 'straight';
  const currentDragArea = isActiveAeroXMode ? DRAG_AREA_X_MODE : DRAG_AREA_Z_MODE;

  // 3. Determine Max Speed for Current Context
  const baseExitSpeedMs = node.base_speed_exit / 3.6;
  
  let contextSpeedLimit = baseExitSpeedMs;
  if (node.type === 'turn') {
      let cornerSpeed = baseExitSpeedMs;
      if (line === 'defense') cornerSpeed *= 0.92;
      else if (line === 'opportunity') cornerSpeed *= 1.05;
      cornerSpeed *= (1 + (driver.cornering_skill / 2000));
      contextSpeedLimit = cornerSpeed;
  }

  let targetSpeedLimit = contextSpeedLimit;
  let brakingMode = false;

  if (!ignoreNextNodeForBraking) {
      const distToNextNode = node.length - distInNode;
      const nextNodeEntrySpeed = nextNode.base_speed_entry / 3.6;
      const brakingDistRaw = (speed * speed - nextNodeEntrySpeed * nextNodeEntrySpeed) / (2 * 4.5 * GRAVITY);
      const brakingDistNeeded = Math.max(0, brakingDistRaw);

      // Check if we need to brake for the next node
      if (distToNextNode < brakingDistNeeded + 20 && nextNodeEntrySpeed < speed) {
          targetSpeedLimit = Math.min(contextSpeedLimit, nextNodeEntrySpeed);
          brakingMode = true;
      }
  }

  // 4. Calculate Forces
  const dragForce = 0.5 * AIR_DENSITY * currentDragArea * speed * speed;
  const rollingRes = ROLLING_RESISTANCE_COEFF * MASS * GRAVITY;
  
  let netForce = 0;
  let batteryChange = 0;

  // Braking Logic
  if (speed > targetSpeedLimit || brakingMode) {
      // BRAKING
      const maxBrakingForce = 4.5 * MASS * GRAVITY * (1 + driver.braking_skill/500); 
      const neededBrakingForce = (MASS * (speed - targetSpeedLimit)) / dt; 
      const brakingForce = Math.min(maxBrakingForce, neededBrakingForce + dragForce); 
      
      netForce = -brakingForce;
      
      // MGU-K Harvesting
      const regenPowerMax = 350000; 
      const brakingPower = brakingForce * speed;
      const regenPower = Math.min(regenPowerMax, brakingPower);
      
      const regenPercentage = (regenPower / 350000) * 8.75 * dt; 
      batteryChange += regenPercentage;

  } else {
      // ACCELERATING / MAINTAINING
      let availablePower = BASE_ENGINE_POWER; 
      
      // ERS Boost
      if (battery > 0) {
          availablePower += ERS_POWER_MAP[ers];
          batteryChange -= ERS_DRAIN_RATE[ers] * dt;
      }
      
      // Skill modifier on power application
      availablePower *= (1 + driver.acceleration_skill / 2000);

      // Force = Power / Velocity
      const effectiveSpeed = Math.max(10, speed); 
      const engineForce = availablePower / effectiveSpeed;
      
      netForce = engineForce - dragForce - rollingRes;
  }

  // Cornering control: smooth accel/decel through turns so exit speed matches curve limits
  if (node.type === 'turn') {
      const remainingDist = Math.max(1, node.length - distInNode);
      const desiredExitSpeed = contextSpeedLimit;
      const aTarget = (desiredExitSpeed * desiredExitSpeed - speed * speed) / (2 * remainingDist);
      const aRaw = netForce / MASS;

      if (aTarget < 0 && aRaw < aTarget) {
          // Too much braking vs what is needed to exit at desired speed
          netForce = aTarget * MASS;
      } else if (aTarget > 0 && aRaw > aTarget) {
          // Too much throttle vs what is needed to exit at desired speed
          netForce = aTarget * MASS;
      }
  }

  // 5. Apply Physics Integration (Euler)
  const acceleration = netForce / MASS;
  speed += acceleration * dt;
  
  speed = Math.max(0, speed);
  // Never exceed context speed limit for this segment (curve limitation)
  speed = Math.min(speed, targetSpeedLimit);

  // 6. Battery Limits
  battery = Math.max(0, Math.min(100, battery + batteryChange));

  return { speed, battery, lateral_offset };
};

export const getInitialRaceState = (track: TrackNode[]): RaceState => {
    let dist = 0;
    track.forEach(node => {
        node.start_dist = dist;
        dist += node.length;
        node.end_dist = dist;
    });

    // Random Grid Assignment (50/50)
    // Grid 1: 0m
    // Grid 2: -10m (Worse Grid)
    const p1Grid = Math.random() > 0.5 ? 1 : 2;
    const p2Grid = p1Grid === 1 ? 2 : 1;

    const p1Dist = p1Grid === 1 ? 0 : -10;
    const p2Dist = p2Grid === 1 ? 0 : -10;

    return {
        time: 0,
        p1: { distance: p1Dist, speed: 0, battery: INITIAL_BATTERY, last_node_id: 0, lateral_offset: 0, target_offset: 0, reaction_end_time: 0 },
        p2: { distance: p2Dist, speed: 0, battery: INITIAL_BATTERY, last_node_id: 0, lateral_offset: 0, target_offset: 0, reaction_end_time: 0 },
        starting_grid: { p1: p1Grid, p2: p2Grid },
        finished: false,
        winner_id: null,
        logs: []
    };
};

export const getTrackNodeAtDist = (track: TrackNode[], dist: number) => {
    return track.find(n => dist >= n.start_dist! && dist < n.end_dist!) || track[track.length-1];
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

    const getNode = (dist: number) => getTrackNodeAtDist(track, dist);
    const getNextNode = (node: TrackNode) => track[(track.indexOf(node) + 1) % track.length];

    const p1Node = getNode(newState.p1.distance);
    const p2Node = getNode(newState.p2.distance);

    newState.p1.last_node_id = p1Node.id;
    newState.p2.last_node_id = p2Node.id;

    // --- Decision Making & Line Strategy ---
    const updateTargetOffset = (playerState: any, opponentState: any, strategy: PlayerStrategy, driver: DriverStats) => {
        if (newState.time >= (playerState.reaction_end_time || 0)) {
            // New Decision
            // Calculate delay: 1s base + (0-2s based on inverse decision skill)
            // Skill 100 -> 0s delay. Skill 0 -> 2s delay. Total 1-3s.
            const reactionDelay = 1 + (Math.random() * (100 - driver.decision_making_skill) / 50);
            playerState.reaction_end_time = newState.time + reactionDelay;

            if (strategy.current_line === 'opportunity') {
                // Different line from opponent
                playerState.target_offset = opponentState.lateral_offset > 0 ? -0.8 : 0.8;
            } else if (strategy.current_line === 'defense') {
                // Same line as opponent
                playerState.target_offset = opponentState.lateral_offset;
            } else {
                // Clean line (center/optimal)
                playerState.target_offset = 0; 
            }
        }
    };

    updateTargetOffset(newState.p1, newState.p2, p1.strategy, p1.driver);
    updateTargetOffset(newState.p2, newState.p1, p2.strategy, p2.driver);

    // --- Physics Simulation (Sub-stepping for accuracy) ---
    const SUB_STEPS = 10;
    const SUB_DT = DT / SUB_STEPS;

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
        const p1WrapsNext = p1NextCurrent.start_dist! < p1NodeCurrent.start_dist!;
        const p1Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p1State.speed, battery: p1State.battery, lateral_offset: p1State.lateral_offset }, 
            p1NodeCurrent, p1NextCurrent, p1State.distance - p1NodeCurrent.start_dist!, 
            p1.driver, p1.strategy.current_ers, p1.strategy.current_line,
            newState.p1.target_offset ?? 0,
            p1WrapsNext
        );
        p1State.speed = p1Res.speed;
        p1State.battery = p1Res.battery;
        p1State.lateral_offset = p1Res.lateral_offset;
        p1State.distance += p1State.speed * SUB_DT;

        // P2 Step
        const p2NodeCurrent = getNode(p2State.distance);
        const p2NextCurrent = getNextNode(p2NodeCurrent);
        const p2WrapsNext = p2NextCurrent.start_dist! < p2NodeCurrent.start_dist!;
        const p2Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p2State.speed, battery: p2State.battery, lateral_offset: p2State.lateral_offset }, 
            p2NodeCurrent, p2NextCurrent, p2State.distance - p2NodeCurrent.start_dist!, 
            p2.driver, p2.strategy.current_ers, p2.strategy.current_line,
            newState.p2.target_offset ?? 0,
            p2WrapsNext
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

    if (Math.abs(distGap) < 15) { // Within 15 meters
        const leader = distGap > 0 ? 'p1' : 'p2';
        const chaser = distGap > 0 ? 'p2' : 'p1';
        const leaderState = leader === 'p1' ? newState.p1 : newState.p2;
        const chaserState = chaser === 'p1' ? newState.p1 : newState.p2;

        // Slipstream
        chaserState.speed *= 1.02; 

        // Overtake Logic
        // "overtakes can only be done if the driver is not on the same line and is faster"
        // Check Line Overlap (if close, e.g. < 0.5 difference)
        const isSameLine = Math.abs(leaderState.lateral_offset - chaserState.lateral_offset) < 0.5;
        
        if (isSameLine) {
            // Blocked! Chaser cannot exceed leader speed
            if (chaserState.speed > leaderState.speed) {
                 chaserState.speed = leaderState.speed; // Brake check
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
        nodeId: p1Node.id, 
        p1_dist: newState.p1.distance,
        p2_dist: newState.p2.distance,
        p1_speed: newState.p1.speed,
        p2_speed: newState.p2.speed,
        p1_battery: newState.p1.battery,
        p2_battery: newState.p2.battery,
        gap: distGap,
        events
    });

    // Check Finish
    if (newState.p1.distance >= trackLength || newState.p2.distance >= trackLength) {
        newState.finished = true;
        newState.winner_id = newState.p1.distance > newState.p2.distance ? p1.id : p2.id;
    }

    return newState;
};
