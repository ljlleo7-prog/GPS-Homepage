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
    distance: number; // Meters (Added)
}

export const calculateGap = (distA: number, distB: number, trackLength: number) => {
    let gap = distB - distA;
    if (gap > trackLength / 2) gap -= trackLength;
    if (gap < -trackLength / 2) gap += trackLength;
    return gap;
};

export const calculatePhysicsStep = (
  dt: number, // seconds
  currentState: PhysicsState,
  opponentState: PhysicsState, // Add opponent state
  gapToOpponent: number, // Signed gap (positive = opponent ahead)
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
  const prevLateralOffset = lateral_offset;
  
  // 1. Lateral Movement towards Target
  const baseLateralSpeed = 1.2;
  const decisionFactor = 0.8 + (driver.decision_making_skill / 25);
  // Opportunity line is aggressive, Defense is standard, Clean is standard
  const lateralSpeed = baseLateralSpeed * decisionFactor * dt; 
  
  if (lateral_offset < targetOffset) lateral_offset = Math.min(targetOffset, lateral_offset + lateralSpeed);
  else if (lateral_offset > targetOffset) lateral_offset = Math.max(targetOffset, lateral_offset - lateralSpeed);

  // 1.1 Line Change Penalty (Induced Drag / Friction)
  // "Changing lines cost temporary 1% speed drop"
  // Interpret as: If moving laterally, add drag or resistance.
  const isMovingLaterally = Math.abs(lateral_offset - prevLateralOffset) > 0.001;

  // 2. Drag & Rolling Resistance
  const isActiveAeroXMode = node.type === 'straight';
  const currentDragArea = isActiveAeroXMode ? DRAG_AREA_X_MODE : DRAG_AREA_Z_MODE;
  
  // INTERACTION LOGIC: Drafting & Dirty Air
  // Use passed gapToOpponent
  // gapToOpponent > 0 means opponent is AHEAD.
  const isBehind = gapToOpponent > 0 && gapToOpponent < 30; // 30m visual range for dirty air/drafting
  const gapToAhead = gapToOpponent;
  
  // Check "Same Line" overlap
  // Assume car width impact is ~0.5 offset range
  const lateralOverlap = Math.abs(currentState.lateral_offset - opponentState.lateral_offset) < 0.4;

  let dragMultiplier = 1.0;
  let corneringMultiplier = 1.0;

  if (isBehind && lateralOverlap) {
      if (node.type === 'straight') {
          // Drafting: Reduced Drag
          // "going on the same line has reduced drag for back car"
          // Reduce drag by up to 30% if very close
          dragMultiplier = 0.7; 
      } else {
          // Dirty Air: Reduced Grip in Corners
          // "going on the same line results in dirty air effect"
          corneringMultiplier = 0.90; // 10% grip loss
      }
  }

  let dragForce = 0.5 * AIR_DENSITY * currentDragArea * dragMultiplier * speed * speed;
  
  // Add Line Change Penalty (1% speed drop effect) -> Add extra drag
  if (isMovingLaterally) {
      // Tuned to 1.2 based on user feedback (approx 1% speed loss over maneuver)
      dragForce *= 1.2; 
  }

  const rollingRes = ROLLING_RESISTANCE_COEFF * MASS * GRAVITY;
  const resistiveForce = dragForce + rollingRes;

  // 3. Physical Limits (Force)
  const effectiveSpeed = Math.max(10, speed); // Avoid division by zero at low speeds

  // Max Acceleration Force (Engine + ERS)
  let availablePower = BASE_ENGINE_POWER; 
  if (battery > 0) {
      availablePower += ERS_POWER_MAP[ers];
  }
  availablePower *= (1 + driver.acceleration_skill / 2000);
  
  const maxEngineForce = availablePower / effectiveSpeed;
  const maxAccelForce = maxEngineForce - resistiveForce; // Net force available for acceleration

  // Max Deceleration Force (Brakes)
  // Base braking force + Skill modifier
  const maxBrakingForce = 4.5 * MASS * GRAVITY * (1 + driver.braking_skill/500); 
  const maxDecelForce = maxBrakingForce + resistiveForce; // Net force available for deceleration (Brakes + Drag helps)

  // 4. Determine Target Velocities & Acceleration Demand
  
  // A) Target Exit Speed for Current Node
  let targetExitSpeedMs = node.base_speed_exit / 3.6;
  const isStraight = node.type === 'straight';

  if (node.type === 'turn') {
      // Apply cornering modifiers
      let cornerSpeed = targetExitSpeedMs;
      // Line modifiers removed (visual only now, except for dirty air)
      // Actually opportunity line might still be faster if clean air?
      // User said: "changing lines cost temporary 1% speed drop"
      // User didn't say Opportunity is faster inherently, just "escaping opponent's line".
      // But presumably escaping dirty air IS the speed boost.
      
      // Apply Dirty Air Penalty
      cornerSpeed *= corneringMultiplier;

      cornerSpeed *= (1 + (driver.cornering_skill / 2000));
      targetExitSpeedMs = cornerSpeed;
  } else {
      // Straight: Uncapped exit speed (allow physics to push max speed)
      targetExitSpeedMs = 9999; 
  }

  // B) Calculate Desired Acceleration to match Exit Speed (Quadratic Curve)
  // v_f^2 = v_i^2 + 2*a*d  =>  a = (v_f^2 - v_i^2) / 2d
  const remainingDist = Math.max(1, node.length - distInNode);
  let a_desired = (targetExitSpeedMs * targetExitSpeedMs - speed * speed) / (2 * remainingDist);

  // C) Check Braking for Next Node
  // If approaching a corner, we may need to brake earlier than the quadratic curve for current node implies
  if (!ignoreNextNodeForBraking) {
      const nextEntrySpeedMs = nextNode.base_speed_entry / 3.6;
      
      // Calculate braking distance needed to hit nextEntrySpeed from current speed
      // d = (v^2 - v_next^2) / (2 * a_max_brake)
      const conservativeBrakeDecel = 4.0 * GRAVITY; // Slightly conservative braking point
      const brakingDistNeeded = Math.max(0, (speed * speed - nextEntrySpeedMs * nextEntrySpeedMs) / (2 * conservativeBrakeDecel));
      
      // If we are within the braking zone (plus a buffer), switch target to Next Node Entry
      if (remainingDist < brakingDistNeeded + 20 && nextEntrySpeedMs < speed) {
          // We need to decelerate to nextEntrySpeedMs by end of current node (remainingDist)
          a_desired = (nextEntrySpeedMs * nextEntrySpeedMs - speed * speed) / (2 * remainingDist);
      }
  }

  // 5. Apply Physical Constraints (Clamp a_desired)
  // Convert a_desired to Target Net Force
  let targetNetForce = a_desired * MASS;

  // Clamp Force between Max Accel and Max Decel
  if (targetNetForce > maxAccelForce) {
      targetNetForce = maxAccelForce;
  } else if (targetNetForce < -maxDecelForce) {
      targetNetForce = -maxDecelForce;
  }

  // 6. Calculate Battery Usage & Final Physics
  // Applied Force = Net Force + Resistive Force
  // If Applied > 0, Engine is working. If Applied < 0, Brakes are working.
  const appliedForce = targetNetForce + resistiveForce;
  let batteryChange = 0;

  if (appliedForce > 0) {
      // Accelerating / Maintaining with Engine
      if (battery > 0) {
          batteryChange -= ERS_DRAIN_RATE[ers] * dt;
      }
  } else {
      // Braking / Regenerating
      // appliedForce is negative. Magnitude is the braking force.
      const brakingForce = -appliedForce;
      
      // MGU-K Harvesting
      const regenPowerMax = 350000; 
      const brakingPower = brakingForce * speed;
      const regenPower = Math.min(regenPowerMax, brakingPower);
      
      // Increased regen factor (was 8.75) to prevent battery drain issues
      const regenPercentage = (regenPower / 350000) * 25.0 * dt; 
      batteryChange += regenPercentage;
  }

  // Apply Acceleration
  const a_actual = targetNetForce / MASS;
  speed += a_actual * dt;
  
  speed = Math.max(0, speed);

  // Hard clamp only for Turn Exit to prevent massive overshoots if physics steps are large
  if (!isStraight && speed > targetExitSpeedMs + 10) {
       // Allow slight overshoot but clamp if excessive
       speed = targetExitSpeedMs + 5; 
  }

  // BLOCKING LOGIC (Collision Prevention)
  // "the car is 5m long, so cannot go within 5m on the same line."
  // If we are behind and gap < 5m and lateral overlap, we cannot exceed opponent speed.
  if (isBehind && gapToAhead < 6 && lateralOverlap) { // 6m to be safe
      // Hard clamp speed to opponent's speed (cannot pass through)
      // Actually, if we are faster, we slam into them.
      // In simulation, we just cap speed to opponent speed.
      if (speed > opponentState.speed) {
          speed = opponentState.speed;
      }
  }

  // Battery Limits
  battery = Math.max(0, Math.min(100, battery + batteryChange));

  return { speed, battery, lateral_offset, distance: currentState.distance };
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
    const updateTargetOffset = (playerState: RaceState['p1'], opponentState: RaceState['p2'], strategy: PlayerStrategy, driver: DriverStats) => {
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

    const p1State = { 
        speed: newState.p1.speed / 3.6, 
        battery: newState.p1.battery, 
        lateral_offset: newState.p1.lateral_offset || 0,
        distance: newState.p1.distance
    };
    const p2State = { 
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
        
        const gapP1toP2 = calculateGap(p1State.distance, p2State.distance, trackLength);

        const p1Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p1State.speed, battery: p1State.battery, lateral_offset: p1State.lateral_offset, distance: p1State.distance }, 
            { speed: p2State.speed, battery: p2State.battery, lateral_offset: p2State.lateral_offset, distance: p2State.distance },
            gapP1toP2,
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
        
        const gapP2toP1 = calculateGap(p2State.distance, p1State.distance, trackLength);

        const p2Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p2State.speed, battery: p2State.battery, lateral_offset: p2State.lateral_offset, distance: p2State.distance }, 
            { speed: p1State.speed, battery: p1State.battery, lateral_offset: p1State.lateral_offset, distance: p1State.distance },
            gapP2toP1,
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

    // Wrap Distances
    if (p1State.distance >= trackLength) p1State.distance -= trackLength;
    if (p2State.distance >= trackLength) p2State.distance -= trackLength;

    // Update State
    newState.p1.speed = p1State.speed * 3.6; // Convert back to km/h
    newState.p1.battery = p1State.battery;
    newState.p1.lateral_offset = p1State.lateral_offset;
    newState.p1.distance = p1State.distance;

    newState.p2.speed = p2State.speed * 3.6;
    newState.p2.battery = p2State.battery;
    newState.p2.lateral_offset = p2State.lateral_offset;
    newState.p2.distance = p2State.distance;

    // Check Finish
    if (newState.time > 10) { // Min race time buffer
        // Simple finish check: if distance "wrapped" or high count.
        // Actually, logic above wraps distance.
        // We need to track total distance or laps.
        // For One Lap Duel, we assume they finish when they cross line.
        // But since we wrap distance, we need to know if they crossed it.
        // The calling code (Room.tsx or Supabase trigger) usually handles "Race Over".
        // Wait, the simulation runs fully in `Room.tsx` or Backend?
        // The `Room.tsx` runs it locally for visualization? No, `Room.tsx` subscribes to updates.
        // `simulation.ts` is likely used by an Edge Function or RPC?
        // Actually, looking at previous context, `process_one_lap_race_finish` parses logs.
        // Where is the simulation RUN? 
        // Likely in the client before submitting? Or in the DB?
        // If it's client-side simulation submitted to DB, then this file matters.
        // If `p1State.distance` wrapped, they finished.
        // But `advanceRaceState` wraps it.
        // We should probably flag finish.
    }
    
    // Gap Calculation
    newState.logs.push({
        time: newState.time,
        nodeId: newState.p1.last_node_id,
        p1_dist: newState.p1.distance,
        p2_dist: newState.p2.distance,
        p1_speed: newState.p1.speed,
        p2_speed: newState.p2.speed,
        p1_battery: newState.p1.battery,
        p2_battery: newState.p2.battery,
        gap: newState.p1.distance - newState.p2.distance, // Approx
        events: []
    });

    return newState;
};
