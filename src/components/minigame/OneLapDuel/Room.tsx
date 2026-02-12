import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { DriverStats, MONZA_TRACK, PlayerStrategy, TRACKS, INITIAL_BATTERY, RaceState, ERSMode, RacingLine, TrackNode } from './types';
import { getInitialRaceState, advanceRaceState, calculatePhysicsStep, getTrackNodeAtDist, SimulationResult, calculateGap, MAX_BATTERY_JOULES, getTargetOffset } from './simulation';
import { Check, User, Zap, MousePointer2, AlertTriangle, Play, Battery, Gauge, Wind, Activity, Map, Trash2, UserMinus, LogOut, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  roomId: string;
  driver: DriverStats;
  onLeave: () => void;
}

export default function Room({ roomId, driver, onLeave }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [strategy, setStrategy] = useState<PlayerStrategy>({
    ers_per_node: {},
    line_per_node: {},
    current_ers: 'neutral',
    current_line: 'clean'
  });
  const [isReady, setIsReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isStarting, setIsStarting] = useState(false); 
  
  // Real-time Race State
  const [raceState, setRaceState] = useState<RaceState | null>(null);
  const raceStateRef = useRef<RaceState | null>(null); // For loop access
  const raceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const clientLoopRef = useRef<NodeJS.Timeout | null>(null); // Client-side prediction loop
  const lastStrategyUpdate = useRef<number>(0); // Rate limiting

  const updateRaceState = (newState: RaceState | null) => {
      raceStateRef.current = newState;
      setRaceState(newState);
  };

  const lastLineChangeNodeRef = useRef<number>(-1);
  const [toast, setToast] = useState<{msg: string, type: 'error' | 'success'} | null>(null);

  const showToast = (msg: string, type: 'error' | 'success' = 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Get Track
  const currentTrack = room?.track_id ? TRACKS[room.track_id] || MONZA_TRACK : MONZA_TRACK;
  const trackLength = currentTrack.reduce((acc, n) => acc + n.length, 0);

  // Fetch initial state & subscribe
  useEffect(() => {
    fetchRoomDetails();
    
    // Update Driver Skills (Lazy Update)
    if (user) {
        supabase.rpc('update_driver_skills', { p_user_id: user.id });
    }

    // Realtime subscription
    const roomChannel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'one_lap_rooms', filter: `id=eq.${roomId}` }, (payload: any) => {
        if (payload.eventType === 'DELETE') {
            onLeave(); 
        } else {
            setRoom(payload.new);
            if (payload.new.status === 'finished') {
                 if (raceIntervalRef.current) clearInterval(raceIntervalRef.current);
            }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'one_lap_room_players', filter: `room_id=eq.${roomId}` }, () => {
        fetchRoomDetails(); 
      })
      .on('broadcast', { event: 'race_update' }, (payload) => {
          updateRaceState(payload.payload);
      })
      .on('broadcast', { event: 'start_countdown' }, () => {
          // Trigger Countdown for Everyone
          if (!isStarting) {
              handleStartCountdown();
          }
      })
      .on('broadcast', { event: 'strategy_update' }, (payload) => {
          // Update local player cache for all clients
          setPlayers(prev => prev.map(p => {
              if (p.user_id === payload.payload.user_id) {
                  return { 
                      ...p, 
                      strategy: {
                          ...p.strategy,
                          current_ers: payload.payload.ers,
                          current_line: payload.payload.line
                      }
                  };
              }
              return p;
          }));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(roomChannel);
      if (raceIntervalRef.current) clearInterval(raceIntervalRef.current);
      if (clientLoopRef.current) clearInterval(clientLoopRef.current);
    };
  }, [roomId]);

  // Client-side Prediction Loop (Inertial Navigation)
  useEffect(() => {
      clientLoopRef.current = setInterval(() => {
          const currentState = raceStateRef.current;
          // Only predict if we are NOT the host (Host has the source of truth engine)
          // Or actually, even host can use this for smoother 60fps UI between 1s ticks? 
          // Yes, let's do it for everyone for smoothness.
          if (!currentState || currentState.finished) return;

          // CRITICAL FIX: Ensure we have complete player data before predicting
          if (playersRef.current.length < 2 || !playersRef.current[0]?.one_lap_drivers || !playersRef.current[1]?.one_lap_drivers) {
              return; // Don't predict without full driver data
          }

          const p1 = playersRef.current[0];
          const p2 = playersRef.current[1];
          if (!p1 || !p2) return;

          const dt = 0.05; // 50ms

          // Predict P1
          const trackLength = currentTrack[currentTrack.length - 1].end_dist!;

          // Helper to get nodes
          const getNodes = (dist: number) => {
              const modDist = dist % trackLength;
              const node = getTrackNodeAtDist(currentTrack, modDist);
              const idx = currentTrack.indexOf(node);
              const nextNode = currentTrack[(idx + 1) % currentTrack.length];
              const wrapsNext = nextNode.start_dist! < node.start_dist!;
              return { node, nextNode, distInNode: modDist - node.start_dist!, wrapsNext };
          };

          const p1Nodes = getNodes(currentState.p1.distance);
          const gapP1toP2 = calculateGap(currentState.p1.distance % trackLength, currentState.p2.distance % trackLength, trackLength);
          
          // Use helper to predict target offset immediately based on strategy
          // This ensures client reacts to "Defense"/"Attack" even before server tick
          const p1TargetOffset = getTargetOffset(p1.strategy.current_line, currentState.p2.lateral_offset || 0);
          
          // Safe driver fallback to prevent NaNs
          const defaultDriver: DriverStats = { 
              user_id: 'fallback',
              acceleration_skill: 50, 
              braking_skill: 50, 
              cornering_skill: 50, 
              ers_efficiency_skill: 50, 
              decision_making_skill: 50, 
              morale: 100,
              daily_dev_accumulated: 0,
              last_training_update: new Date().toISOString(),
              training_mode: 'rest',
              focused_skills: []
          };
          const p1Driver = p1.one_lap_drivers || defaultDriver;

          const p1Res = calculatePhysicsStep(dt, {
              speed: (currentState.p1.speed || 0) / 3.6,
              battery: currentState.p1.battery || 0, // NaN guard
              lateral_offset: currentState.p1.lateral_offset || 0,
              distance: currentState.p1.distance || 0,
              recovered_energy: currentState.p1.recovered_energy || 0
          }, {
              speed: (currentState.p2.speed || 0) / 3.6,
              battery: currentState.p2.battery || 0,
              lateral_offset: currentState.p2.lateral_offset || 0,
              distance: currentState.p2.distance || 0,
              recovered_energy: currentState.p2.recovered_energy || 0
          }, 
          gapP1toP2,
          p1Nodes.node, p1Nodes.nextNode, p1Nodes.distInNode, 
          p1Driver,
          p1.strategy.current_ers, p1.strategy.current_line, 
          p1TargetOffset, // Use calculated target instead of potentially stale state
          p1Nodes.wrapsNext);

          // Predict P2
          const p2Nodes = getNodes(currentState.p2.distance);
          const gapP2toP1 = calculateGap(currentState.p2.distance % trackLength, currentState.p1.distance % trackLength, trackLength);
          
          const p2TargetOffset = getTargetOffset(p2.strategy.current_line, currentState.p1.lateral_offset || 0);
          const p2Driver = p2.one_lap_drivers || defaultDriver;

          const p2Res = calculatePhysicsStep(dt, {
              speed: (currentState.p2.speed || 0) / 3.6,
              battery: currentState.p2.battery || 0,
              lateral_offset: currentState.p2.lateral_offset || 0,
              distance: currentState.p2.distance || 0,
              recovered_energy: currentState.p2.recovered_energy || 0
          }, {
              speed: (currentState.p1.speed || 0) / 3.6,
              battery: currentState.p1.battery || 0,
              lateral_offset: currentState.p1.lateral_offset || 0,
              distance: currentState.p1.distance || 0,
              recovered_energy: currentState.p1.recovered_energy || 0
          }, 
          gapP2toP1,
          p2Nodes.node, p2Nodes.nextNode, p2Nodes.distInNode, 
          p2Driver, 
          p2.strategy.current_ers, p2.strategy.current_line, 
          p2TargetOffset, 
          p2Nodes.wrapsNext);

          // Update State (Optimistic)
          updateRaceState({
              ...currentState,
              p1: {
                  ...currentState.p1,
                  speed: p1Res.speed * 3.6,
                  battery: p1Res.battery,
                  lateral_offset: p1Res.lateral_offset,
                  distance: currentState.p1.distance + (p1Res.speed * dt),
                  recovered_energy: p1Res.recovered_energy
              },
              p2: {
                  ...currentState.p2,
                  speed: p2Res.speed * 3.6,
                  battery: p2Res.battery,
                  lateral_offset: p2Res.lateral_offset,
                  distance: currentState.p2.distance + (p2Res.speed * dt),
                  recovered_energy: p2Res.recovered_energy
              }
          });

      }, 50);

      return () => {
          if (clientLoopRef.current) clearInterval(clientLoopRef.current);
      };
  }, [currentTrack]); 

  // Watch for Finish
  useEffect(() => {
    if (raceState?.finished && raceState.winner_id) {
        const isWinner = raceState.winner_id === user?.id;
        
        // Calculate Points (Display Only)
        let points = 0;
        
        if (players.length >= 2) {
             const isP1Winner = raceState.winner_id === players[0].user_id;
             const winnerState = isP1Winner ? raceState.p1 : raceState.p2;
             const loserState = isP1Winner ? raceState.p2 : raceState.p1;
             
             const gapDist = Math.abs(winnerState.distance - loserState.distance);
             const loserSpeedMs = Math.max(5, loserState.speed / 3.6);
             const timeGap = gapDist / loserSpeedMs;
             
             if (timeGap < 0.2) points = 1;
             else if (timeGap < 0.5) points = 2;
             else if (timeGap < 1.0) points = 3;
             else if (timeGap < 2.0) points = 4;
             else points = 5;
             
             // Multiplier
             let multiplier = 1;
             if (isP1Winner) {
                 if (raceState.starting_grid.p1 === 2) multiplier = 2;
             } else {
                 if (raceState.starting_grid.p2 === 2) multiplier = 2;
             }
             points *= multiplier;
        }

        if (isWinner) {
             setToast({ type: 'success', msg: `${t('minigame_onelapduel.room.victory_reward') || 'Victory!'} +5 Tokens & +${points} Points` });
             
             // Update Tokens (Wallet) - Client Side
             // Points are handled by Host to ensure consistency
             (async () => {
                 try {
                     const { data: pData } = await supabase.from('wallets').select('token_balance').eq('user_id', user.id).single();
                    
                    if (pData) {
                        await supabase.from('wallets').update({ 
                            token_balance: (pData.token_balance || 0) + 5 
                        }).eq('user_id', user.id);
                    }
                 } catch (e) {
                     console.error('Error updating tokens:', e);
                 }
             })();

        } else {
             setToast({ type: 'error', msg: t('minigame_onelapduel.room.defeat_reward') || 'Defeat. 0 Points.' });
        }
    }
  }, [raceState?.finished, raceState?.winner_id, user?.id]);

  const fetchRoomDetails = async () => {
    const { data: roomData, error: roomError } = await supabase.from('one_lap_rooms').select('*').eq('id', roomId).single();
    if (roomError) console.error('Error fetching room:', roomError);

    const { data: playersData, error: playersError } = await supabase
      .from('one_lap_room_players')
      .select('*, profiles(username, avatar_url, one_lap_drivers(*))')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true });
    
    if (playersError) console.error('Error fetching players:', playersError);
    
    if (roomData) {
        setRoom(roomData);
        // If room is finished, fetch results to reconstruct state
        if (roomData.status === 'finished' && !raceState) {
             const { data: raceData } = await supabase
                .from('one_lap_races')
                .select('*')
                .eq('room_id', roomId)
                .single();
            
            if (raceData && raceData.simulation_log) {
                // Reconstruct finished state
                const logs = raceData.simulation_log;
                const lastLog = logs[logs.length - 1];
                updateRaceState({
                    time: lastLog.time,
                    p1: { distance: lastLog.p1_dist, speed: lastLog.p1_speed, battery: lastLog.p1_battery, recovered_energy: lastLog.p1_recovered || 0, last_node_id: lastLog.nodeId, lateral_offset: 0 },
                    p2: { distance: lastLog.p2_dist, speed: lastLog.p2_speed, battery: lastLog.p2_battery, recovered_energy: lastLog.p2_recovered || 0, last_node_id: lastLog.nodeId, lateral_offset: 0 },
                    finished: true,
                    winner_id: raceData.winner_id,
                    logs: logs
                });
            }
        }
    }

    if (playersData) {
        const processedPlayers = playersData.map((p: any) => ({
            ...p,
            one_lap_drivers: p.profiles?.one_lap_drivers?.[0] || p.profiles?.one_lap_drivers || null,
            // Ensure strategy has realtime fields
            strategy: {
                ...p.strategy,
                current_ers: p.strategy?.current_ers || 'neutral',
                current_line: p.strategy?.current_line || 'clean'
            }
        }));
        
        setPlayers(processedPlayers);
        
        const myPlayer = processedPlayers.find((p: any) => p.user_id === user?.id);
        if (myPlayer) {
            // Only update local ready state if it matches server to avoid jitter, 
            // BUT we trust server as source of truth.
            // If we just clicked ready, we might want to ignore a stale fetch?
            // For now, let's log it.
            // console.log('Synced Ready State:', myPlayer.is_ready);
            setIsReady(myPlayer.is_ready);
            if (myPlayer.strategy) {
                setStrategy(myPlayer.strategy);
            }
        }
    }
  };

  // Check for start condition
  useEffect(() => {
    if (players.length === 2 && players.every(p => p.is_ready) && room?.status === 'open' && !isStarting && !raceState) {
        // Only Host initiates
        if (room?.created_by === user?.id) {
            initiateRaceStart();
        }
    }
  }, [players, room, raceState, isStarting, user?.id]);

  const initiateRaceStart = async () => {
    if (isStarting || raceState) return;

    // Start locally for Host immediately (broadcast might not echo back)
    handleStartCountdown();
    
    await supabase.channel(`room:${roomId}`).send({
        type: 'broadcast',
        event: 'start_countdown',
        payload: {}
    });
  };

  const handleStartCountdown = () => {
    if (isStarting) return;
    setIsStarting(true);
    setCountdown(5);
    let count = 5;
    const interval = setInterval(() => {
        count--;
        setCountdown(count);
        if (count === 0) {
            clearInterval(interval);
            setCountdown(null);
            
            // Host starts the engine
            const amIHost = room?.created_by === user?.id;
            if (amIHost) {
                runSimulation();
            }
        }
    }, 1000);
  };

  // Ref for players to access inside interval
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);

  const startRaceEngineRef = async () => {
      const initialState = getInitialRaceState(currentTrack);
      
      let currentState = initialState;
      updateRaceState(currentState);

      // Broadcast Start
      supabase.channel(`room:${roomId}`).send({
          type: 'broadcast',
          event: 'race_update',
          payload: initialState
      });

      raceIntervalRef.current = setInterval(async () => {
          if (currentState.finished) {
              if (raceIntervalRef.current) clearInterval(raceIntervalRef.current);
              
              await supabase.from('one_lap_races').insert([{
                  room_id: roomId,
                  winner_id: currentState.winner_id,
                  simulation_log: currentState.logs
              }]);
              await supabase.from('one_lap_rooms').update({ status: 'finished' }).eq('id', roomId);

              // Explicit Stats Update (Fix for "Win not applied")
              if (currentState.winner_id) {
                  // Calculate Points based on New Policy
                  const p1 = playersRef.current[0];
                  const p2 = playersRef.current[1];
                  
                  if (p1 && p2) {
                      const isP1Winner = currentState.winner_id === p1.user_id;
                      const winnerState = isP1Winner ? currentState.p1 : currentState.p2;
                      const loserState = isP1Winner ? currentState.p2 : currentState.p1;
                      
                      // Calculate Time Gap
                      const gapDist = Math.abs(winnerState.distance - loserState.distance);
                      const loserSpeedMs = Math.max(5, loserState.speed / 3.6); // Min 5m/s to avoid infinity
                      const timeGap = gapDist / loserSpeedMs;
                      
                      let points = 0;
                      if (timeGap < 0.2) points = 1;
                      else if (timeGap < 0.5) points = 2;
                      else if (timeGap < 1.0) points = 3;
                      else if (timeGap < 2.0) points = 4;
                      else points = 5;
                      
                      // Overtake Multiplier (If Winner started P2/Behind)
                      // Grid 1 = Ahead (0m), Grid 2 = Behind (-10m)
                      let multiplier = 1;
                      if (isP1Winner) {
                          if (currentState.starting_grid.p1 === 2) multiplier = 2;
                      } else {
                          if (currentState.starting_grid.p2 === 2) multiplier = 2;
                      }
                      
                      const totalPoints = points * multiplier;

                      const loserId = isP1Winner ? p2.user_id : p1.user_id;

                      // Winner: +1 Win, +Points, Update Best Gap
                      const { data: wData, error: wError } = await supabase.from('one_lap_drivers').select('wins, points, best_gap_sec').eq('user_id', currentState.winner_id).single();
                      if (wError) console.error('Error fetching winner data:', wError);
                      if (wData) {
                          // Calculate Best Gap (More negative is better)
                          const currentGap = -timeGap;
                          const oldBest = wData.best_gap_sec !== undefined && wData.best_gap_sec !== null ? wData.best_gap_sec : 999;
                          const newBest = Math.min(currentGap, oldBest);

                          const { error: wUpdateError } = await supabase.from('one_lap_drivers').update({ 
                              wins: (wData.wins || 0) + 1, 
                              points: (wData.points || 0) + totalPoints,
                              best_gap_sec: newBest
                          }).eq('user_id', currentState.winner_id);
                          if (wUpdateError) console.error('Error updating winner stats:', wUpdateError);
                          
                          // Update Leaderboard
                          // Try RPC first, fallback to direct update if function missing
                          const { error: rpcError } = await supabase.rpc('update_leaderboard_from_driver', { p_user_id: currentState.winner_id });
                          if (rpcError) {
                              const { data: existingLB } = await supabase.from('one_lap_leaderboard').select('races_played').eq('user_id', currentState.winner_id).single();
                              await supabase.from('one_lap_leaderboard').upsert({
                                  user_id: currentState.winner_id,
                                  wins: (wData.wins || 0) + 1,
                                  total_points: (wData.points || 0) + totalPoints,
                                  races_played: (existingLB?.races_played || 0) + 1,
                                  best_gap_sec: newBest,
                                  updated_at: new Date().toISOString()
                              });
                          }
                      }

                      // Loser: +1 Loss
                      const { data: lData, error: lError } = await supabase.from('one_lap_drivers').select('losses').eq('user_id', loserId).single();
                      if (lError) console.error('Error fetching loser data:', lError);
                      if (lData) {
                          const { error: lUpdateError } = await supabase.from('one_lap_drivers').update({ 
                              losses: (lData.losses || 0) + 1 
                          }).eq('user_id', loserId);
                          if (lUpdateError) console.error('Error updating loser stats:', lUpdateError);

                          // Update Leaderboard
                          await supabase.rpc('update_leaderboard_from_driver', { p_user_id: loserId });
                      }

                      // Update Prize Pool & Winner Balance
                      try {
                        const { data: prizePool, error: prizePoolError } = await supabase
                          .from("minigame_prize_pools")
                          .select("current_pool")
                          .eq("game_key", "one_lap_duel")
                          .single();

                        if (prizePoolError) throw prizePoolError;

                        const prizeAmount = Math.floor(prizePool.current_pool * 0.1); // Winner gets 10%
                        const newPool = prizePool.current_pool + 2; // Prize pool increases by 2 every round (no exceptions)

                        await supabase
                          .from("minigame_prize_pools")
                          .update({ current_pool: newPool })
                          .eq("game_key", "one_lap_duel");
                        
                        const { data: winnerWallet, error: winnerWalletError } = await supabase
                            .from('wallets')
                            .select('token_balance')
                            .eq('user_id', currentState.winner_id)
                            .single();

                        if (winnerWalletError) throw winnerWalletError;

                        await supabase
                            .from('wallets')
                            .update({ token_balance: (winnerWallet.token_balance || 0) + prizeAmount })
                            .eq('user_id', currentState.winner_id);

                      } catch (e) {
                          console.error("Failed to process prize pool:", e);
                      }
                  }
              }

              return;
          }

          const p1 = playersRef.current[0];
          const p2 = playersRef.current[1];

          if (!p1 || !p2) return; // Safety check

          currentState = advanceRaceState(
              currentState,
              { id: p1.user_id, driver: p1.one_lap_drivers, strategy: p1.strategy },
              { id: p2.user_id, driver: p2.one_lap_drivers, strategy: p2.strategy },
              currentTrack
          );

          updateRaceState(currentState);
          
          // Broadcast
          supabase.channel(`room:${roomId}`).send({
              type: 'broadcast',
              event: 'race_update',
              payload: currentState
          });

      }, 1000); // 1 tick per second
  };

  const runSimulation = () => {
      const amIHost = room?.created_by === user?.id;
      if (amIHost) {
          startRaceEngineRef();
      }
  };

  const updateRealtimeStrategy = async (type: 'ers' | 'line', value: string) => {
      const now = Date.now();
      if (now - lastStrategyUpdate.current < 500) return; // 500ms debounce
      
      if (!raceState || players.length < 2) return;
      const myPlayerState = players[0].user_id === user?.id ? raceState.p1 : raceState.p2;
      const currentNodeId = myPlayerState.last_node_id;

      if (type === 'line') {
        // Single-line strategy limit removed per user request
    }
    
    lastStrategyUpdate.current = now;

    const newStrategy = {
        ...strategy,
        [type === 'ers' ? 'current_ers' : 'current_line']: value
    };
    setStrategy(newStrategy);

    // Update players state immediately for local user (since we might not receive own broadcast)
    setPlayers(prev => prev.map(p => 
        p.user_id === user?.id 
            ? { ...p, strategy: newStrategy }
            : p
    ));

      // Broadcast to Host
      await supabase.channel(`room:${roomId}`).send({
          type: 'broadcast',
          event: 'strategy_update',
          payload: {
              user_id: user?.id,
              ers: type === 'ers' ? value : strategy.current_ers,
              line: type === 'line' ? value : strategy.current_line
          }
      });
  };

  const toggleReady = async () => {
    if (!user) return;
    
    // Safety check: am I in the room?
    const myPlayer = players.find(p => p.user_id === user.id);
    if (!myPlayer) {
        showToast('Error: You are not in this room.', 'error');
        return;
    }

    const newReady = !isReady;
    setIsReady(newReady);
    
    // Optimistic update
    setPlayers(prev => prev.map(p => 
        p.user_id === user.id ? { ...p, is_ready: newReady } : p
    ));
    
    const { error } = await supabase
        .from('one_lap_room_players')
        .update({ 
            is_ready: newReady,
            strategy: strategy
        })
        .eq('room_id', roomId)
        .eq('user_id', user.id);

    if (error) {
        console.error('Error toggling ready:', error);
        showToast('Failed to update status. Please try again.', 'error');
        // Revert optimistic update
        setIsReady(!newReady);
        fetchRoomDetails();
    }
  };

  const handleExit = async () => {
    if (!user) return;
    const isHost = room?.created_by === user.id;

    // Use a robust delete approach
    // If we are host, we should delete the room.
    // If we are guest, we should delete our player entry.
    // However, sometimes RLS or Foreign Key constraints fail if not handled cleanly.
    // Let's use an RPC or explicit sequence.

    try {
        if (isHost) {
            // Delete room (Cascade should handle players, but let's be safe)
            // User reported corruption, so maybe cascade isn't working perfectly?
            // Actually, if we delete the room, everything linked to it should go.
            const { error } = await supabase.from('one_lap_rooms').delete().eq('id', roomId);
            if (error) console.error('Error deleting room:', error);
        } else {
            // Guest leaving
            const { error } = await supabase.from('one_lap_room_players').delete().eq('room_id', roomId).eq('user_id', user.id);
             if (error) console.error('Error leaving room:', error);
        }
    } catch (e) {
        console.error('Exception during exit:', e);
    }
    
    // Always clean up local state
    onLeave();
  };

  const handleDeleteRoom = async () => {
    if (!confirm(t('minigame_onelapduel.room.confirm_delete'))) return;
    const { error } = await supabase.from('one_lap_rooms').delete().eq('id', roomId);
    if (error) {
        console.error('Error deleting room:', error);
        setToast({ type: 'error', msg: 'Failed to delete room' });
    } else {
        onLeave();
    }
  };

  const handleKickOpponent = async (playerId: string) => {
    if (!confirm(t('minigame_onelapduel.room.confirm_kick'))) return;
    const { error } = await supabase.from('one_lap_room_players').delete().eq('room_id', roomId).eq('user_id', playerId);
     if (error) {
        console.error('Error kicking player:', error);
    }
  };

  const handleJoin = async () => {
    if (!user) return;
    const { error } = await supabase
      .from('one_lap_room_players')
      .insert([{ room_id: roomId, user_id: user.id, is_ready: false }]);
    
    if (error) {
        console.error('Join error:', error);
        showToast('Failed to join room', 'error');
    } else {
        fetchRoomDetails();
    }
  };

  const isRacing = !!raceState;
  const myPlayer = players.find(p => p.user_id === user?.id);
  
  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
        <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
                {t(`minigame_onelapduel.room.track_${room?.track_id || 'monza'}`) || 'Monza'} 
                <span className="text-sm font-normal text-gray-400 bg-neutral-800 px-2 py-1 rounded">1 {t('minigame_onelapduel.room.lap')}</span>
            </h2>
            <div className="text-sm text-gray-500">{t('minigame_onelapduel.room.room_id')} {roomId.slice(0,8)}...</div>
        </div>
        <div className="flex items-center gap-4">
            {!isRacing && (
                 <div className="text-[10px] text-gray-600 hidden md:block font-mono">
                     {room?.status} • {players.length}/2 • R:{players.filter(p=>p.is_ready).length}
                 </div>
            )}
            {!isRacing && room?.created_by === user?.id && players.length === 2 && (
                 <button 
                     onClick={() => initiateRaceStart()}
                     className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded uppercase transition-colors"
                 >
                     {t('minigame_onelapduel.room.force_start') || 'Force Start'}
                 </button>
            )}
            <div className="flex gap-2">
                {room?.created_by === user?.id && (
                    <div className="flex gap-2 mr-2 border-r border-white/20 pr-2">
                        <button 
                            onClick={handleDeleteRoom}
                            className="px-3 py-1 bg-red-900/50 hover:bg-red-900 text-red-200 rounded flex items-center gap-2 text-sm border border-red-700/50 transition-colors"
                        >
                            <Trash2 size={14} />
                            {t('minigame_onelapduel.room.delete_room')}
                        </button>
                        {players.length > 1 && (
                             <button 
                                onClick={() => {
                                    const opponent = players.find(p => p.user_id !== user.id);
                                    if (opponent) handleKickOpponent(opponent.user_id);
                                }}
                                className="px-3 py-1 bg-orange-900/50 hover:bg-orange-900 text-orange-200 rounded flex items-center gap-2 text-sm border border-orange-700/50 transition-colors"
                            >
                                <UserMinus size={14} />
                                {t('minigame_onelapduel.room.kick_opponent')}
                            </button>
                        )}
                    </div>
                )}
                <button
                    onClick={handleExit}
                    className="px-4 py-1 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-2 text-sm transition-colors"
                >
                    <LogOut size={14} />
                    {t('minigame_onelapduel.room.exit')}
                </button>
            </div>
        </div>
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full font-bold shadow-lg
                    ${toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-black'}`}
            >
                {toast.msg}
            </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      {countdown !== null ? (
        <div className="text-center py-20">
            <div className="text-6xl font-black text-f1-red mb-4 animate-ping">{countdown}</div>
            <p className="text-xl text-gray-400">{t('minigame_onelapduel.room.race_starting')}</p>
        </div>
      ) : isRacing ? (
        // Real-time Race Visualization
        <div className="bg-black p-6 rounded-lg border border-white/10 relative">
            {/* Track Progress */}
            <div className="relative h-32 bg-neutral-900 rounded-xl mb-8 border border-white/5 overflow-hidden group">
                {/* Track Map Visualization (Background) */}
                <div className="absolute inset-0 flex h-full opacity-30">
                    {currentTrack.map((node, i) => {
                        const widthPct = (node.length / trackLength) * 100;
                        let colorClass = 'bg-green-500'; // Straight / X Mode
                        if (node.type === 'turn') {
                            const speed = node.base_speed_exit;
                            if (speed < 120) colorClass = 'bg-red-600'; // Low Speed
                            else if (speed < 200) colorClass = 'bg-orange-500'; // Mid Speed
                            else colorClass = 'bg-yellow-500'; // High Speed
                        }
                        return (
                            <div 
                                key={i} 
                                style={{ width: `${widthPct}%` }} 
                                className={`h-full ${colorClass} border-r border-black/20`}
                                title={`${t(`minigame_onelapduel.room.track.${node.name_key}`)} (${node.length}m)`}
                            />
                        );
                    })}
                </div>

                {/* Track Surface & Racing Lines Guide */}
                <div className="absolute inset-0 flex flex-col z-10">
                     <div className="flex-1 border-b border-white/5 flex items-center px-2 text-[10px] text-white/20">Outside (Opportunity)</div>
                     <div className="flex-1 border-b border-dashed border-white/10 flex items-center px-2 text-[10px] text-white/20">Center (Clean)</div>
                     <div className="flex-1 flex items-center px-2 text-[10px] text-white/20">Inside (Defense)</div>
                </div>

                {/* Start/Finish Line */}
                <div className="absolute top-0 bottom-0 left-[5%] w-0.5 bg-white/20" />
                <div className="absolute top-0 bottom-0 right-[5%] w-0.5 bg-checkerboard opacity-50" />

                {/* Cars */}
                {players.map((p, idx) => {
                    const pState = idx === 0 ? raceState.p1 : raceState.p2;
                    const progress = (pState.distance / trackLength) * 100;
                    const lateral = pState.lateral_offset ?? 0; // -1 to 1

                    return (
                        <motion.div 
                            key={p.user_id}
                            className={`absolute z-${20-idx} flex flex-col items-center w-20`}
                            animate={{ 
                                left: `${Math.min(95, Math.max(5, progress))}%`,
                                top: `${50 + (lateral * 35)}%`
                            }}
                            transition={{ ease: "linear", duration: 1 }}
                            style={{ x: '-50%', y: '-50%' }}
                        >
                             <div className={`w-10 h-5 ${idx===0 ? 'bg-blue-500' : 'bg-orange-500'} rounded shadow-lg border border-white/50 relative flex items-center justify-center`}>
                                <div className="absolute -right-1 top-0 bottom-0 w-1 bg-black/20" />
                                <span className="text-[8px] font-black text-white/90">{pState.speed.toFixed(0)}</span>
                            </div>
                            <div className={`mt-1 text-[10px] font-bold ${idx===0 ? 'text-blue-400' : 'text-orange-400'} whitespace-nowrap bg-black/50 px-1 rounded`}>
                                {p.profiles?.username}
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* Telemetry & Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {players.map((p, idx) => {
                    const pState = idx === 0 ? raceState.p1 : raceState.p2;
                    const isMe = p.user_id === user?.id;
                    return (
                        <div key={p.user_id} className={`bg-neutral-900 rounded-lg p-4 border-l-4 ${idx===0 ? 'border-blue-500' : 'border-orange-500'} ${isMe ? 'ring-1 ring-white/20' : ''}`}>
                            <div className="flex justify-between items-center mb-4">
                                <span className={`font-bold ${idx===0 ? 'text-blue-400' : 'text-orange-400'}`}>{p.profiles?.username}</span>
                                {isMe && <span className="text-xs bg-white/10 text-white px-2 py-1 rounded">YOU</span>}
                            </div>
                            
                            {/* Stats */}
                            <div className="grid grid-cols-3 gap-2 mb-4">
                                <div className="bg-black/30 p-2 rounded">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><Gauge className="w-3 h-3"/> SPEED</div>
                                    <div className="text-2xl font-mono font-bold">{pState.speed.toFixed(0)}</div>
                                </div>
                                <div className="bg-black/30 p-2 rounded">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><Battery className="w-3 h-3"/> SOC</div>
                                    <div className={`text-2xl font-mono font-bold ${(pState.battery / MAX_BATTERY_JOULES) < 0.2 ? 'text-red-500 animate-pulse' : 'text-green-400'}`}>
                                        {((pState.battery / MAX_BATTERY_JOULES) * 100).toFixed(0)}%
                                    </div>
                                </div>
                                <div className="bg-black/30 p-2 rounded">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><Activity className="w-3 h-3"/> PWR</div>
                                    {(() => {
                                        // @ts-ignore
                                        const power = pState.current_power || 0; // Watts
                                        const powerKw = Math.round(power / 1000);
                                        let color = 'text-gray-500';
                                        if (power < -1000) color = 'text-green-400'; // Regen (Green)
                                        else if (power > 200000) color = 'text-red-500'; // High Deploy (Red)
                                        else if (power > 1000) color = 'text-yellow-400'; // Low Deploy (Yellow)
                                        
                                        return (
                                            <div className={`text-xl font-bold font-mono ${color}`}>
                                                {powerKw > 0 ? '+' : ''}{powerKw}kW
                                            </div>
                                        );
                                    })()}
                                </div>
                                {/* Active Aero Status */}
                                <div className="bg-black/30 p-2 rounded">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><Wind className="w-3 h-3"/> AERO</div>
                                    {getTrackNodeAtDist(currentTrack, pState.distance).type === 'straight' ? (
                                        <div className="text-sm font-bold text-cyan-400 flex items-center gap-1 animate-pulse">
                                            DRS OPEN
                                        </div>
                                    ) : (
                                        <div className="text-sm font-bold text-gray-400">
                                            CLOSED
                                        </div>
                                    )}
                                </div>
                                {/* ERS State */}
                                <div className="bg-black/30 p-2 rounded">
                                    <div className="text-xs text-gray-500 flex items-center gap-1"><Zap className="w-3 h-3"/> ERS</div>
                                    <div className={`text-sm font-bold uppercase ${
                                        p.strategy.current_ers === 'overtake' ? 'text-red-500' :
                                        p.strategy.current_ers === 'hotlap' ? 'text-blue-400' :
                                        p.strategy.current_ers === 'recharge' ? 'text-green-400' : 'text-gray-400'
                                    }`}>
                                        {p.strategy.current_ers}
                                    </div>
                                </div>
                            </div>

                            {/* Controls (Only for Me) */}
                            {isMe && !raceState.finished && (
                                <div className="space-y-3 border-t border-white/5 pt-4">
                                    <div>
                                        <div className="text-xs text-gray-500 mb-2 uppercase">ERS Mode</div>
                                        <div className="grid grid-cols-4 gap-1">
                                            {(['neutral', 'hotlap', 'overtake', 'recharge'] as const).map(mode => (
                                                <button
                                                    key={mode}
                                                    onClick={() => updateRealtimeStrategy('ers', mode)}
                                                    className={`px-1 py-2 rounded text-[10px] uppercase font-bold transition-colors
                                                        ${strategy.current_ers === mode 
                                                            ? 'bg-f1-red text-white' 
                                                            : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                                >
                                                    {mode}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-gray-500 mb-2 uppercase">Racing Line</div>
                                        <div className="grid grid-cols-3 gap-1">
                                            {(['clean', 'defense', 'opportunity'] as const).map(line => (
                                                <button
                                                    key={line}
                                                    onClick={() => updateRealtimeStrategy('line', line)}
                                                    className={`px-1 py-2 rounded text-[10px] uppercase font-bold transition-colors
                                                        ${strategy.current_line === line 
                                                            ? 'bg-blue-600 text-white' 
                                                            : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
                                                >
                                                    {line}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            
            {/* Events Log */}
            <div className="mt-6 h-32 overflow-y-auto bg-black/50 rounded p-2 text-xs font-mono space-y-1">
                {raceState.logs.slice(-5).reverse().map((log, i) => (
                    log.events.length > 0 && log.events.map((e: any, j: number) => (
                        <div key={`${i}-${j}`} className="text-yellow-400">
                             [{log.time}s] {e.type === 'overtake_chance' ? 'OVERTAKE ATTEMPT!' : 'DEFENSE SUCCESSFUL!'}
                        </div>
                    ))
                ))}
            </div>

            {/* Finish Overlay */}
            {raceState.finished && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
                    <h2 className="text-6xl font-black italic text-white mb-4">
                        {raceState.winner_id === user?.id ? 'VICTORY' : 'DEFEAT'}
                    </h2>
                    <button onClick={handleExit} className="bg-white text-black px-8 py-3 rounded-full font-bold hover:bg-gray-200">
                        RETURN TO LOBBY
                    </button>
                </div>
            )}
        </div>
      ) : (
        <>
        {/* Lobby / Strategy Selection */}
        <div className="mb-8">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Map className="w-5 h-5 text-f1-red" />
                {t('minigame_onelapduel.room.track_preview') || 'Track Preview'}
            </h3>
             <div className="relative h-24 bg-neutral-900 rounded-xl border border-white/5 overflow-hidden">
                <div className="absolute inset-0 flex h-full">
                    {currentTrack.map((node, i) => {
                        const widthPct = (node.length / trackLength) * 100;
                        let colorClass = 'bg-green-500'; // Straight / X Mode
                        if (node.type === 'turn') {
                            const speed = node.base_speed_exit;
                            if (speed < 120) colorClass = 'bg-red-600'; // Low Speed
                            else if (speed < 200) colorClass = 'bg-orange-500'; // Mid Speed
                            else colorClass = 'bg-yellow-500'; // High Speed
                        }
                        return (
                            <div 
                                key={i} 
                                style={{ width: `${widthPct}%` }} 
                                className={`h-full ${colorClass} border-r border-black/20 opacity-80`}
                                title={`${t(`minigame_onelapduel.room.track.${node.name_key}`)} (${node.length}m)`}
                            />
                        );
                    })}
                </div>
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2">
                 <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-sm"></div> Straight/X-Mode
                    <div className="w-3 h-3 bg-red-600 rounded-sm"></div> Low Speed
                    <div className="w-3 h-3 bg-orange-500 rounded-sm"></div> Mid Speed
                    <div className="w-3 h-3 bg-yellow-500 rounded-sm"></div> High Speed
                 </div>
                 <div>{trackLength}m</div>
            </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
             {players.map((p) => (
                <div key={p.user_id} className={`p-4 rounded-lg border ${p.is_ready ? 'border-green-500/50 bg-green-500/10' : 'border-white/10 bg-surface'}`}>
                    <div className="flex items-center gap-3">
                        {p.profiles?.avatar_url ? (
                            <img src={p.profiles.avatar_url} className="w-12 h-12 rounded-full" />
                        ) : (
                            <div className="w-12 h-12 bg-neutral-700 rounded-full flex items-center justify-center">
                                <User className="w-6 h-6 text-gray-400" />
                            </div>
                        )}
                        <div>
                            <div className="font-bold">{p.profiles?.username}</div>
                            <div className={`text-sm ${p.is_ready ? 'text-green-400' : 'text-yellow-400'}`}>
                                {p.is_ready ? t('minigame_onelapduel.room.ready_status') : t('minigame_onelapduel.room.preparing_status')}
                            </div>
                        </div>
                    </div>
                </div>
             ))}
             {players.length < 2 && (
                 <div className="p-4 rounded-lg border border-white/10 bg-black/20 flex items-center justify-center text-gray-500 animate-pulse">
                     {t('minigame_onelapduel.room.waiting_opponent')}
                 </div>
             )}
        </div>
      </>
      )}
      
      {!isRacing && (
        <div className="flex justify-center mt-8">
             {!myPlayer ? (
                 <button 
                     onClick={handleJoin}
                     className="px-12 py-4 rounded-full text-xl font-bold bg-white text-black hover:bg-gray-200 transition-all transform hover:scale-105"
                 >
                     {t('minigame_onelapduel.lobby.join_race') || 'Join Race'}
                 </button>
             ) : (
                 <button 
                     onClick={toggleReady}
                     className={`px-12 py-4 rounded-full text-xl font-bold transition-all transform hover:scale-105
                         ${isReady ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-green-500 text-black hover:bg-green-400'}`}
                 >
                     {isReady ? t('minigame_onelapduel.room.cancel_ready') : t('minigame_onelapduel.room.ready_button')}
                 </button>
             )}
        </div>
      )}
    </div>
  );
}
