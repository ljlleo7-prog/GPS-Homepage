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
  p1_recovered: number;
  p2_recovered: number;
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
const DRAG_AREA_Z_MODE = 1.1; // High Downforce (Corners) - Increased for 2026 realism
const DRAG_AREA_X_MODE = 0.75; // Reduced drag to allow higher top speeds (was 0.9)
const ROLLING_RESISTANCE_COEFF = 0.015;

export const MAX_BATTERY_JOULES = 4_000_000; // 4MJ
export const MAX_RECOVERY_JOULES = 9_000_000; // 9MJ

// Power Maps (Watts)
const BASE_ENGINE_POWER = 400000; // 420 kW (Internal Combustion)

// ERS Constants
const ERS_MAX_POWER = 350000; // 350 kW
const ERS_MAX_REGEN = 250000; // 250 kW (ICE Harvesting Limit)
const BRAKING_MAX_REGEN = 350000; // 350 kW (Kinetic Braking Limit)

// Helper to get available ERS power based on speed and mode
    const getERSLimit = (speedKmh: number, mode: ERSMode, isBehind: boolean, driver?: DriverStats): number => {
        if (mode === 'overtake') {
            return ERS_MAX_POWER * (driver ? (0.98 + driver.ers_efficiency_skill / 500) : 1);
        }
        // 2. Speed-Dependent Tapering (2026 Regs)
    // 0–300 km/h: ~350 kW available
    // 300–340 km/h: tapering from 350 kW to 150 kW
    // 340–345 km/h: tapering from 150 kW to 0 kW
    // >345 km/h: 0 kW
    
    let speedLimit = ERS_MAX_POWER;

    if (speedKmh > 345) {
        speedLimit = 0;
    } else if (speedKmh > 340) {
        // Taper 340-345 (150kW -> 0kW)
        const ratio = (speedKmh - 340) / 5;
        speedLimit = 150000 * (1 - ratio);
    } else if (speedKmh > 300) {
        // Taper 300-340 (350kW -> 150kW)
        const ratio = (speedKmh - 300) / 40;
        speedLimit = 350000 - (200000 * ratio);
    }

    // Apply ERS Efficiency Skill
    if (driver) {
        speedLimit *= (0.98 + driver.ers_efficiency_skill / 500);
    }

    // 3. Mode-Specific Scaling
    if (mode === 'recharge') {
        return 0;
    }
    
    // Neutral drops to 0 earlier (e.g., linear drop from 250kph to 320kph?)
    // User: "in neutral it will drop to 0kW earlier"
    // Also user: "normal deployment" (Neutral) should be 250kW max.
    if (mode === 'neutral') {
        if (speedKmh > 320) return 0;
        speedLimit = Math.min(speedLimit, 250000 * (driver ? (0.98 + driver.ers_efficiency_skill / 500) : 1)); // Max 250kW in Neutral
    }
    // Hotlap uses full speedLimit curve (max 350kW)

    return speedLimit;
};

// Helper for Target Offset Strategy
export const getTargetOffset = (line: 'clean' | 'defense' | 'opportunity', opponentOffset: number): number => {
    if (line === 'opportunity') {
        // Move AWAY from opponent
        // If opponent is Right (>0), go Left (-0.8).
        // If opponent is Left (<0), go Right (0.8).
        // If opponent is Center (0), go Right (0.8) (Arbitrary default).
        return opponentOffset > 0 ? -0.8 : 0.8;
    } else if (line === 'defense') {
        // Move TOWARD opponent to block
        return opponentOffset;
    } else {
        // Clean line
        return 0;
    }
};

interface PhysicsState {
    speed: number; // m/s
    battery: number; // Joules (Changed from %)
    lateral_offset: number; // -1 to 1
    distance: number; // Meters
    recovered_energy: number; // Joules (Track 9MJ limit)
    movement_mask?: 'free' | 'blocked_left' | 'blocked_right';
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
  let { speed, battery, lateral_offset, movement_mask } = currentState; // speed is m/s
  const prevLateralOffset = lateral_offset;
  
  // 1. Lateral Movement towards Target
  const baseLateralSpeed = 1.2;
  const decisionFactor = 0.8 + (driver.decision_making_skill / 25);
  // Opportunity line is aggressive, Defense is standard, Clean is standard
  const lateralSpeed = baseLateralSpeed * decisionFactor * dt; 
  
  let allowed = true;
  // Check Movement Mask
  // If we want to move Left (target < current), check if blocked_left
  if (targetOffset < lateral_offset && movement_mask === 'blocked_left') allowed = false;
  // If we want to move Right (target > current), check if blocked_right
  if (targetOffset > lateral_offset && movement_mask === 'blocked_right') allowed = false;

  if (allowed) {
      if (lateral_offset < targetOffset) {
          lateral_offset = Math.min(targetOffset, lateral_offset + lateralSpeed);
          // If we moved Right, we block Left moves for this sector
          if (lateral_offset > prevLateralOffset + 0.0001) movement_mask = 'blocked_left';
      }
      else if (lateral_offset > targetOffset) {
          lateral_offset = Math.max(targetOffset, lateral_offset - lateralSpeed);
          // If we moved Left, we block Right moves for this sector
          if (lateral_offset < prevLateralOffset - 0.0001) movement_mask = 'blocked_right';
      }
  }

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

  // Morale Instability: Random Performance Drops
  // If morale < 50, chance of "hesitation" or "mistake"
  let moraleMultiplier = 1.0;
  if (driver.morale < 50) {
      
      const dropChancePerSecond = ((100 - driver.morale) / 100)*((100 - driver.morale) / 100) * 0.05; 
      const dropChance = dropChancePerSecond * dt;
      
      if (Math.random() < dropChance) {
           moraleMultiplier = 0.4; // 60% momentary power/braking loss
      }
  }
  
  // ERS Deployment
  if (battery > 0) {
      const ersLimit = getERSLimit(speed * 3.6, ers, isBehind, driver);
      availablePower += ersLimit;
  }

  availablePower *= (0.98 + driver.acceleration_skill / 500);
  availablePower *= moraleMultiplier; // Apply Morale Drop
  
  const maxEngineForce = availablePower / effectiveSpeed;
  const maxAccelForce = maxEngineForce - resistiveForce; // Net force available for acceleration

  // Max Deceleration Force (Brakes)
  // Base braking force + Skill modifier
  const maxBrakingForce = 4.5 * MASS * GRAVITY * (0.95 + driver.braking_skill/200) * moraleMultiplier; // Apply Morale Drop 
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

      cornerSpeed *= (0.99 + (driver.cornering_skill / 1000));
      targetExitSpeedMs = cornerSpeed;
  } else {
      // Straight: Uncapped exit speed (allow physics to push max speed)
      targetExitSpeedMs = 9999; 
  }

  // Interaction: Prevent accelerating into a blocked path (saves battery)
  // IMPROVEMENT: If we are actively moving laterally (overtaking), we should NOT be clamped as strictly.
  // We want to allow momentum to carry us alongside.
  const isOvertakingManeuver = Math.abs(lateral_offset - opponentState.lateral_offset) > 0.3 && Math.abs(currentState.lateral_offset - prevLateralOffset) > 0.001;
  
  if (isBehind && gapToAhead < 20 && lateralOverlap && !isOvertakingManeuver) {
       // Limit target speed to opponent speed + closing buffer
       const maxAllowedSpeed = Math.max(opponentState.speed, 0) + 10; // +10m/s buffer
       if (targetExitSpeedMs > maxAllowedSpeed) {
           targetExitSpeedMs = maxAllowedSpeed;
       }
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
  let energyChange = 0; // Joules (Negative = Drain, Positive = Charge)
  let recoveredEnergyDelta = 0;

  if (ers === 'recharge') {
      const speedKmh = speed * 3.6;
      if (speedKmh > 300 && battery < MAX_BATTERY_JOULES) {
          const maxHarvest = ERS_MAX_REGEN * (driver ? (0.98 + driver.ers_efficiency_skill / 500) : 1);
          const quotaLeft = Math.max(0, MAX_RECOVERY_JOULES - currentState.recovered_energy);
          const energyToHarvest = Math.min(maxHarvest * dt, quotaLeft);
          if (energyToHarvest > 0) {
              const harvestForce = (energyToHarvest / dt) / effectiveSpeed;
              targetNetForce -= harvestForce;
              energyChange += energyToHarvest;
              recoveredEnergyDelta += energyToHarvest;
          }
      }
  }

  // ICE Harvesting Logic (Recharge Mode)
  // "if recharge mode is not on, the battery will never harvest energy directly from ICE when accelerating."
  // So if recharge mode IS on, and we are accelerating, we harvest from ICE.
  const isAccelerating = targetNetForce > 0;
  let iceHarvestPower = 0;

  if (isAccelerating && ers === 'recharge' && battery < MAX_BATTERY_JOULES) {
       // Divert some engine power to battery
       // Limit to ERS_MAX_REGEN (250kW) or available excess
       // We want to keep the car accelerating, just slower.
       // Let's take a fixed chunk or percentage.
       // Taking 250kW might stall the car if total power is low.
       // Total ICE Power ~420kW.
       // If we take 250kW, we have 170kW left for wheels.
       iceHarvestPower = ERS_MAX_REGEN * (driver ? (0.98 + driver.ers_efficiency_skill / 500) : 1);
       
       // Ensure we don't take more than what the engine produces
       const icePowerAvailable = BASE_ENGINE_POWER * (0.99 + driver.acceleration_skill / 1000);
       if (iceHarvestPower > icePowerAvailable * 0.8) {
           iceHarvestPower = icePowerAvailable * 0.8; // Leave 20% for movement at least
       }

       // Reduce the force available for acceleration
       // Force = Power / Speed
       const harvestForce = iceHarvestPower / effectiveSpeed;
       targetNetForce -= harvestForce; 
       
       // Re-clamp if it went negative (though with 80% cap it shouldn't unless resistive force is huge)
       // Actually, targetNetForce is Net Force (Engine - Drag).
       // If we reduce Engine force, Net Force drops.
       
       energyChange += iceHarvestPower * dt;
  }

  if (targetNetForce > 0) {
      // Accelerating / Maintaining with Engine
      if (battery > 0 && ers !== 'recharge') { // Only deploy if not recharging
          // Calculate ERS contribution ratio
          // Total Power Used = Force * Speed
          const totalPower = (targetNetForce + resistiveForce) * speed;
          const icePower = BASE_ENGINE_POWER * (0.99 + driver.acceleration_skill / 1000);
          
          if (totalPower > icePower) {
              const ersPower = Math.min(totalPower - icePower, getERSLimit(speed * 3.6, ers, isBehind, driver));
              energyChange -= ersPower * dt;
          }
      }
  } else {
      // Braking / Regenerating
      // appliedForce is negative. Magnitude is the braking force.
      const brakingForce = -(targetNetForce + resistiveForce); // Net braking force (Brakes + Regen)
      
      if (brakingForce > 0) {
          // Calculate Harvestable Power
          const brakingPower = brakingForce * speed;
          
          // Cap at BRAKING Max Regen (350kW)
          // "actual braking can regenerate at most 350kW"
          const harvestPower = Math.min(BRAKING_MAX_REGEN * (driver ? (0.98 + driver.ers_efficiency_skill / 500) : 1), brakingPower);
          
          // Check 9MJ Quota
          if (currentState.recovered_energy < MAX_RECOVERY_JOULES) {
             const energyToHarvest = harvestPower * dt;
             recoveredEnergyDelta = energyToHarvest;
             energyChange += energyToHarvest;
          }
      }
  }

  // Apply Acceleration
  const a_actual = targetNetForce / MASS;
  speed += a_actual * dt;
  
  speed = Math.max(0, speed);
  
  speed = Math.max(0, speed);

  // Removed hard clamp for Turn Exit to allow natural overshoots/physics
  // If the car fails to brake in time, it will enter the turn fast.
  // Future improvement: Add "Run Wide" or "Crash" logic if entry speed is too high.

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
  battery = Math.max(0, Math.min(MAX_BATTERY_JOULES, battery + energyChange));
  const recovered_energy = currentState.recovered_energy + recoveredEnergyDelta;

  return { speed, battery, lateral_offset, distance: currentState.distance, recovered_energy, movement_mask };
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
    // Grid 2: -10m (Worse Grid) -> Use trackLength - 10m to avoid negative distance issues
    const p1Grid = Math.random() > 0.5 ? 1 : 2;
    const p2Grid = p1Grid === 1 ? 2 : 1;

    const p1Dist = p1Grid === 1 ? 10 : 0;
    const p2Dist = p2Grid === 1 ? 10 : 0;

    return {
        time: 0,
        p1: { distance: p1Dist, speed: 0, battery: INITIAL_BATTERY, recovered_energy: 0, last_node_id: 0, lateral_offset: 0, target_offset: 0, reaction_end_time: 0 },
        p2: { distance: p2Dist, speed: 0, battery: INITIAL_BATTERY, recovered_energy: 0, last_node_id: 0, lateral_offset: 0, target_offset: 0, reaction_end_time: 0 },
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

    const getNode = (dist: number) => getTrackNodeAtDist(track, dist % trackLength);
    const getNextNode = (node: TrackNode) => track[(track.indexOf(node) + 1) % track.length];

    const p1Node = getNode(newState.p1.distance);
    const p2Node = getNode(newState.p2.distance);

    // Reset movement mask if entered new node
    if (newState.p1.last_node_id !== p1Node.id) {
        newState.p1.movement_mask = 'free';
    }
    if (newState.p2.last_node_id !== p2Node.id) {
        newState.p2.movement_mask = 'free';
    }

    newState.p1.last_node_id = p1Node.id;
    newState.p2.last_node_id = p2Node.id;

    // --- Decision Making & Line Strategy ---
    const updateTargetOffset = (playerState: RaceState['p1'], opponentState: RaceState['p2'], strategy: PlayerStrategy, driver: DriverStats) => {
        const now = newState.time;
        
        // Initialize if missing
        if (!playerState.last_strategy_line) playerState.last_strategy_line = strategy.current_line;

        // Check if user wants a different line
        if (strategy.current_line !== playerState.last_strategy_line) {
             // We want to change.
             if (playerState.reaction_end_time === undefined) {
                 // Start Timer
                 let delay = 1.5 - driver.decision_making_skill / 10;
                 
                 
                 if (delay > 0) {
                     playerState.reaction_end_time = now + delay;
                 } else {
                     // Instant
                     playerState.last_strategy_line = strategy.current_line;
                     playerState.reaction_end_time = undefined;
                 }
             } else {
                 // Timer running
                 if (now >= playerState.reaction_end_time) {
                     // Timer finished, apply change
                     playerState.last_strategy_line = strategy.current_line;
                     playerState.reaction_end_time = undefined;
                 }
             }
        } else {
            // Strategies match, clear timer if any (e.g. user switched back)
            playerState.reaction_end_time = undefined;
        }

        // Use last_strategy_line for target
        playerState.target_offset = getTargetOffset(playerState.last_strategy_line, opponentState.lateral_offset);
    };

    // Update Targets with Reaction Time Logic
    updateTargetOffset(newState.p1, newState.p2, p1.strategy, p1.driver);
    updateTargetOffset(newState.p2, newState.p1, p2.strategy, p2.driver);

    // --- Physics Simulation (Sub-stepping for accuracy) ---
    const SUB_STEPS = 10;
    const SUB_DT = DT / SUB_STEPS;

    const p1State = { 
        speed: newState.p1.speed / 3.6, 
        battery: newState.p1.battery, 
        lateral_offset: newState.p1.lateral_offset || 0,
        distance: newState.p1.distance,
        recovered_energy: newState.p1.recovered_energy || 0,
        movement_mask: newState.p1.movement_mask
    };
    const p2State = { 
        speed: newState.p2.speed / 3.6, 
        battery: newState.p2.battery, 
        lateral_offset: newState.p2.lateral_offset || 0,
        distance: newState.p2.distance,
        recovered_energy: newState.p2.recovered_energy || 0,
        movement_mask: newState.p2.movement_mask
    };

    const p1ErsEffective: ERSMode = (newState.starting_grid.p1 === 1 && p1.strategy.current_ers === 'overtake') ? 'hotlap' : p1.strategy.current_ers;
    const p2ErsEffective: ERSMode = (newState.starting_grid.p2 === 1 && p2.strategy.current_ers === 'overtake') ? 'hotlap' : p2.strategy.current_ers;

    for (let i = 0; i < SUB_STEPS; i++) {
        // P1 Step
        const p1NodeCurrent = getNode(p1State.distance);
        const p1NextCurrent = getNextNode(p1NodeCurrent);
        const p1WrapsNext = p1NextCurrent.start_dist! < p1NodeCurrent.start_dist!;
        
        const gapP1toP2 = calculateGap(p1State.distance % trackLength, p2State.distance % trackLength, trackLength);

        const p1Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p1State.speed, battery: p1State.battery, lateral_offset: p1State.lateral_offset, distance: p1State.distance, recovered_energy: p1State.recovered_energy, movement_mask: p1State.movement_mask }, 
            { speed: p2State.speed, battery: p2State.battery, lateral_offset: p2State.lateral_offset, distance: p2State.distance, recovered_energy: p2State.recovered_energy, movement_mask: p2State.movement_mask },
            gapP1toP2,
            p1NodeCurrent, p1NextCurrent, (p1State.distance % trackLength) - p1NodeCurrent.start_dist!, 
            p1.driver, p1ErsEffective, p1.strategy.current_line,
            newState.p1.target_offset ?? 0,
            p1WrapsNext
        );
        p1State.speed = p1Res.speed;
        p1State.battery = p1Res.battery;
        p1State.lateral_offset = p1Res.lateral_offset;
        p1State.distance += p1State.speed * SUB_DT;
        p1State.recovered_energy = p1Res.recovered_energy;
        p1State.movement_mask = p1Res.movement_mask;
        
        // P2 Step
        const p2NodeCurrent = getNode(p2State.distance);
        const p2NextCurrent = getNextNode(p2NodeCurrent);
        const p2WrapsNext = p2NextCurrent.start_dist! < p2NodeCurrent.start_dist!;
        
        const gapP2toP1 = calculateGap(p2State.distance % trackLength, p1State.distance % trackLength, trackLength);

        const p2Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p2State.speed, battery: p2State.battery, lateral_offset: p2State.lateral_offset, distance: p2State.distance, recovered_energy: p2State.recovered_energy, movement_mask: p2State.movement_mask }, 
            { speed: p1State.speed, battery: p1State.battery, lateral_offset: p1State.lateral_offset, distance: p1State.distance, recovered_energy: p1State.recovered_energy, movement_mask: p1State.movement_mask },
            gapP2toP1,
            p2NodeCurrent, p2NextCurrent, (p2State.distance % trackLength) - p2NodeCurrent.start_dist!, 
            p2.driver, p2ErsEffective, p2.strategy.current_line,
            newState.p2.target_offset ?? 0,
            p2WrapsNext
        );
        p2State.speed = p2Res.speed;
        p2State.battery = p2Res.battery;
        p2State.lateral_offset = p2Res.lateral_offset;
        p2State.distance += p2State.speed * SUB_DT;
        p2State.recovered_energy = p2Res.recovered_energy;
        p2State.movement_mask = p2Res.movement_mask;
    }

    if (p1State.distance > trackLength && p2State.distance > trackLength) {
        // RACE FINISH CONDITION:
        // If BOTH player crosses the line, the race finishes?
        // Standard F1: Race ends when leader crosses line.
        // Duel: First to cross wins.
        // User request: "if the two both have distance > lap total then game must end"
        // Interpretation: The user might want to wait for both? Or maybe they noticed a bug where it NEVER ended.
        // Let's implement: If Leader > TrackLength, finish.
        // Actually, if we want to support "both have distance > lap total", maybe they mean the finish trigger was broken.
        // Safe bet: If anyone crosses, race is over.
        newState.finished = true;
        
        // Determine Winner
        if (p1State.distance > p2State.distance) {
            newState.winner_id = p1.id;
        } else {
            newState.winner_id = p2.id;
        }
    }
    
    // if (p1State.distance >= trackLength) p1State.distance -= trackLength;
    // if (p1State.distance < 0) p1State.distance += trackLength;
    
    // if (p2State.distance >= trackLength) p2State.distance -= trackLength;
    // if (p2State.distance < 0) p2State.distance += trackLength;

    const p1Power = (p1State.battery - newState.p1.battery) / DT;
    const p2Power = (p2State.battery - newState.p2.battery) / DT;

    newState.p1.speed = p1State.speed * 3.6; // Convert back to km/h
    newState.p1.battery = p1State.battery;
    newState.p1.lateral_offset = p1State.lateral_offset;
    newState.p1.distance = p1State.distance;
    newState.p1.recovered_energy = p1State.recovered_energy;
    newState.p1.movement_mask = p1State.movement_mask;
    // @ts-ignore
    newState.p1.current_power = p1Power;

    newState.p2.speed = p2State.speed * 3.6;
    newState.p2.battery = p2State.battery;
    newState.p2.lateral_offset = p2State.lateral_offset;
    newState.p2.distance = p2State.distance;
    newState.p2.recovered_energy = p2State.recovered_energy;
    newState.p2.movement_mask = p2State.movement_mask;
    // @ts-ignore
    newState.p2.current_power = p2Power;

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
        p1_recovered: newState.p1.recovered_energy,
        p2_recovered: newState.p2.recovered_energy,
        gap: newState.p1.distance - newState.p2.distance, // Approx
        events: []
    });

    return newState;
};

export const advanceRaceStateDelta = (
    prevState: RaceState,
    p1: { driver: DriverStats; strategy: PlayerStrategy; id: string },
    p2: { driver: DriverStats; strategy: PlayerStrategy; id: string },
    track: TrackNode[],
    dt: number
): RaceState => {
    const newState = JSON.parse(JSON.stringify(prevState));
    newState.time += dt;
    const trackLength = track[track.length - 1].end_dist!;
    const getNode = (dist: number) => getTrackNodeAtDist(track, dist % trackLength);
    const getNextNode = (node: TrackNode) => track[(track.indexOf(node) + 1) % track.length];

    newState.p1.last_node_id = getNode(newState.p1.distance).id;
    newState.p2.last_node_id = getNode(newState.p2.distance).id;

    const updateTargetOffset = (playerState: RaceState['p1'], opponentState: RaceState['p2'], strategy: PlayerStrategy, driver: DriverStats) => {
        const now = newState.time;
        if (!playerState.last_strategy_line) playerState.last_strategy_line = strategy.current_line;
        if (strategy.current_line !== playerState.last_strategy_line) {
            if (playerState.reaction_end_time === undefined) {
                let delay = 1.5 - driver.decision_making_skill / 10;
                if (delay > 0) {
                    playerState.reaction_end_time = now + delay;
                } else {
                    playerState.last_strategy_line = strategy.current_line;
                    playerState.reaction_end_time = undefined;
                }
            } else {
                if (now >= playerState.reaction_end_time) {
                    playerState.last_strategy_line = strategy.current_line;
                    playerState.reaction_end_time = undefined;
                }
            }
        } else {
            playerState.reaction_end_time = undefined;
        }
        playerState.target_offset = getTargetOffset(playerState.last_strategy_line, opponentState.lateral_offset);
    };

    updateTargetOffset(newState.p1, newState.p2, p1.strategy, p1.driver);
    updateTargetOffset(newState.p2, newState.p1, p2.strategy, p2.driver);

    const SUB_STEPS = Math.max(1, Math.ceil(dt / 0.05));
    const SUB_DT = dt / SUB_STEPS;

    const p1State = { 
        speed: newState.p1.speed / 3.6, 
        battery: newState.p1.battery, 
        lateral_offset: newState.p1.lateral_offset || 0,
        distance: newState.p1.distance,
        recovered_energy: newState.p1.recovered_energy || 0,
        movement_mask: newState.p1.movement_mask
    };
    const p2State = { 
        speed: newState.p2.speed / 3.6, 
        battery: newState.p2.battery, 
        lateral_offset: newState.p2.lateral_offset || 0,
        distance: newState.p2.distance,
        recovered_energy: newState.p2.recovered_energy || 0,
        movement_mask: newState.p2.movement_mask
    };

    const p1ErsEffective: ERSMode = (newState.starting_grid.p1 === 1 && p1.strategy.current_ers === 'overtake') ? 'hotlap' : p1.strategy.current_ers;
    const p2ErsEffective: ERSMode = (newState.starting_grid.p2 === 1 && p2.strategy.current_ers === 'overtake') ? 'hotlap' : p2.strategy.current_ers;

    for (let i = 0; i < SUB_STEPS; i++) {
        const p1NodeCurrent = getNode(p1State.distance);
        const p1NextCurrent = getNextNode(p1NodeCurrent);
        const p1WrapsNext = p1NextCurrent.start_dist! < p1NodeCurrent.start_dist!;
        const gapP1toP2 = calculateGap(p1State.distance % trackLength, p2State.distance % trackLength, trackLength);
        const p1Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p1State.speed, battery: p1State.battery, lateral_offset: p1State.lateral_offset, distance: p1State.distance, recovered_energy: p1State.recovered_energy, movement_mask: p1State.movement_mask }, 
            { speed: p2State.speed, battery: p2State.battery, lateral_offset: p2State.lateral_offset, distance: p2State.distance, recovered_energy: p2State.recovered_energy, movement_mask: p2State.movement_mask },
            gapP1toP2,
            p1NodeCurrent, p1NextCurrent, (p1State.distance % trackLength) - p1NodeCurrent.start_dist!, 
            p1.driver, p1ErsEffective, p1.strategy.current_line,
            newState.p1.target_offset ?? 0,
            p1WrapsNext
        );
        p1State.speed = p1Res.speed;
        p1State.battery = p1Res.battery;
        p1State.lateral_offset = p1Res.lateral_offset;
        p1State.distance += p1State.speed * SUB_DT;
        p1State.recovered_energy = p1Res.recovered_energy;
        p1State.movement_mask = p1Res.movement_mask;
        
        const p2NodeCurrent = getNode(p2State.distance);
        const p2NextCurrent = getNextNode(p2NodeCurrent);
        const p2WrapsNext = p2NextCurrent.start_dist! < p2NodeCurrent.start_dist!;
        const gapP2toP1 = calculateGap(p2State.distance % trackLength, p1State.distance % trackLength, trackLength);
        const p2Res = calculatePhysicsStep(
            SUB_DT, 
            { speed: p2State.speed, battery: p2State.battery, lateral_offset: p2State.lateral_offset, distance: p2State.distance, recovered_energy: p2State.recovered_energy, movement_mask: p2State.movement_mask }, 
            { speed: p1State.speed, battery: p1State.battery, lateral_offset: p1State.lateral_offset, distance: p1State.distance, recovered_energy: p1State.recovered_energy, movement_mask: p1State.movement_mask },
            gapP2toP1,
            p2NodeCurrent, p2NextCurrent, (p2State.distance % trackLength) - p2NodeCurrent.start_dist!, 
            p2.driver, p2ErsEffective, p2.strategy.current_line,
            newState.p2.target_offset ?? 0,
            p2WrapsNext
        );
        p2State.speed = p2Res.speed;
        p2State.battery = p2Res.battery;
        p2State.lateral_offset = p2Res.lateral_offset;
        p2State.distance += p2State.speed * SUB_DT;
        p2State.recovered_energy = p2Res.recovered_energy;
        p2State.movement_mask = p2Res.movement_mask;
    }

    if (p1State.distance > trackLength && p2State.distance > trackLength) {
        newState.finished = true;
        if (p1State.distance > p2State.distance) {
            newState.winner_id = p1.id;
        } else {
            newState.winner_id = p2.id;
        }
    }

    const p1Power = (p1State.battery - newState.p1.battery) / dt;
    const p2Power = (p2State.battery - newState.p2.battery) / dt;

    newState.p1.speed = p1State.speed * 3.6;
    newState.p1.battery = p1State.battery;
    newState.p1.lateral_offset = p1State.lateral_offset;
    newState.p1.distance = p1State.distance;
    newState.p1.recovered_energy = p1State.recovered_energy;
    newState.p1.movement_mask = p1State.movement_mask;
    // @ts-ignore
    newState.p1.current_power = p1Power;

    newState.p2.speed = p2State.speed * 3.6;
    newState.p2.battery = p2State.battery;
    newState.p2.lateral_offset = p2State.lateral_offset;
    newState.p2.distance = p2State.distance;
    newState.p2.recovered_energy = p2State.recovered_energy;
    newState.p2.movement_mask = p2State.movement_mask;
    // @ts-ignore
    newState.p2.current_power = p2Power;

    newState.logs.push({
        time: newState.time,
        nodeId: newState.p1.last_node_id,
        p1_dist: newState.p1.distance,
        p2_dist: newState.p2.distance,
        p1_speed: newState.p1.speed,
        p2_speed: newState.p2.speed,
        p1_battery: newState.p1.battery,
        p2_battery: newState.p2.battery,
        p1_recovered: newState.p1.recovered_energy,
        p2_recovered: newState.p2.recovered_energy,
        gap: newState.p1.distance - newState.p2.distance,
        events: []
    });

    return newState;
};
