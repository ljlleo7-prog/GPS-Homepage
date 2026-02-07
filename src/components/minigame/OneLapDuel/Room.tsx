import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { DriverStats, MONZA_TRACK, PlayerStrategy, RacingLine, ERSMode } from './types';
import { simulateRace, SimulationResult } from './simulation';
import { Check, User, AlertTriangle, Play, ChevronRight, Zap, Shield, MousePointer2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  roomId: string;
  driver: DriverStats;
  onLeave: () => void;
}

export default function Room({ roomId, driver, onLeave }: Props) {
  const { user } = useAuth();
  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [strategy, setStrategy] = useState<PlayerStrategy>({
    ers_per_node: {},
    line_per_node: {}
  });
  const [isReady, setIsReady] = useState(false);
  const [raceResult, setRaceResult] = useState<SimulationResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [simulationStep, setSimulationStep] = useState(0); // For replay

  // Fetch initial state & subscribe
  useEffect(() => {
    fetchRoomDetails();

    const roomChannel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'one_lap_rooms', filter: `id=eq.${roomId}` }, (payload: any) => {
        setRoom(payload.new);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'one_lap_room_players', filter: `room_id=eq.${roomId}` }, () => {
        fetchRoomDetails(); // Reload players
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'one_lap_races', filter: `room_id=eq.${roomId}` }, (payload: any) => {
        // Race finished!
        if (payload.new.simulation_log) {
            setRaceResult({
                winner_id: payload.new.winner_id,
                p1_total_time: 0, // In log
                p2_total_time: 0, // In log
                logs: payload.new.simulation_log
            });
            // Start visualization
            startReplay();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(roomChannel);
    };
  }, [roomId]);

  const fetchRoomDetails = async () => {
    const { data: roomData } = await supabase.from('one_lap_rooms').select('*').eq('id', roomId).single();
    const { data: playersData } = await supabase
      .from('one_lap_room_players')
      .select('*, profiles(username, avatar_url), one_lap_drivers(*)')
      .eq('room_id', roomId);
    
    setRoom(roomData);
    if (playersData) {
        setPlayers(playersData);
        // Load my strategy if saved
        const myPlayer = playersData.find((p: any) => p.user_id === user?.id);
        if (myPlayer) {
            setIsReady(myPlayer.is_ready);
            if (myPlayer.strategy && Object.keys(myPlayer.strategy).length > 0) {
                setStrategy(myPlayer.strategy);
            }
        }
    }
  };

  // Check for start condition
  useEffect(() => {
    if (players.length === 2 && players.every(p => p.is_ready) && room?.status === 'open' && !countdown) {
        // Start Countdown
        startRaceSequence();
    }
  }, [players, room]);

  const startRaceSequence = async () => {
    setCountdown(5);
    let count = 5;
    const interval = setInterval(() => {
        count--;
        setCountdown(count);
        if (count === 0) {
            clearInterval(interval);
            setCountdown(null);
            runSimulation();
        }
    }, 1000);
  };

  const runSimulation = async () => {
    // Only the host (creator) runs the sim to avoid duplicates
    // Or simpler: The last person to ready up runs it? 
    // Let's rely on whoever is first in the list (usually creator) to run it.
    if (!user || !players.length) return;
    
    const amIHost = players[0].user_id === user.id;
    if (!amIHost) return;

    // Run Sim
    const p1 = players[0];
    const p2 = players[1];

    // Prepare data
    const p1Data = { 
        id: p1.user_id, 
        driver: p1.one_lap_drivers, 
        strategy: p1.strategy || { ers_per_node: {}, line_per_node: {} } 
    };
    const p2Data = { 
        id: p2.user_id, 
        driver: p2.one_lap_drivers, 
        strategy: p2.strategy || { ers_per_node: {}, line_per_node: {} } 
    };

    const result = simulateRace(p1Data, p2Data);

    // Save Result
    await supabase.from('one_lap_races').insert([{
        room_id: roomId,
        winner_id: result.winner_id,
        simulation_log: result.logs
    }]);

    // Update Room Status
    await supabase.from('one_lap_rooms').update({ status: 'finished' }).eq('id', roomId);
    
    // Distribute Rewards (Client-side trigger for now - ideally backend)
    // Winner gets 2 tokens
    // We assume 'play_reaction_game' logic handles deduction, but here we just award winner.
    // For MVP we skip economy transaction or call a generic 'add_tokens' rpc if available.
    // Using ledger_entries manually if possible, or just updating wallet.
    // Let's just log it for now.
  };

  const startReplay = () => {
    setSimulationStep(0);
    const interval = setInterval(() => {
        setSimulationStep(prev => {
            if (prev >= MONZA_TRACK.length - 1) {
                clearInterval(interval);
                return prev;
            }
            return prev + 1;
        });
    }, 1500); // 1.5s per turn
  };

  const toggleReady = async () => {
    if (!user) return;
    const newReady = !isReady;
    setIsReady(newReady);
    
    await supabase
        .from('one_lap_room_players')
        .update({ 
            is_ready: newReady,
            strategy: strategy
        })
        .eq('room_id', roomId)
        .eq('user_id', user.id);
  };

  const updateStrategy = (nodeId: number, type: 'ers' | 'line', value: string) => {
    setStrategy(prev => ({
        ...prev,
        [type === 'ers' ? 'ers_per_node' : 'line_per_node']: {
            ...prev[type === 'ers' ? 'ers_per_node' : 'line_per_node'],
            [nodeId]: value
        }
    }));
  };

  // Render Helpers
  const currentLog = raceResult?.logs[simulationStep];
  const isRacing = !!raceResult;

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
        <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
                Monza GP <span className="text-sm font-normal text-gray-400 bg-neutral-800 px-2 py-1 rounded">1 Lap</span>
            </h2>
            <div className="text-sm text-gray-500">Room: {roomId.slice(0,8)}...</div>
        </div>
        <button onClick={onLeave} className="text-gray-400 hover:text-white">Exit Room</button>
      </div>

      {/* Players */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {players.map((p, idx) => (
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
                        <div className="font-bold flex items-center gap-2">
                            {p.profiles?.username}
                            {p.user_id === user?.id && <span className="text-xs bg-primary text-black px-1 rounded">YOU</span>}
                        </div>
                        <div className={`text-sm ${p.is_ready ? 'text-green-400' : 'text-yellow-400'}`}>
                            {p.is_ready ? 'READY' : 'PREPARING'}
                        </div>
                    </div>
                </div>
            </div>
        ))}
        {players.length < 2 && (
            <div className="p-4 rounded-lg border border-white/10 bg-black/20 flex items-center justify-center text-gray-500 animate-pulse">
                Waiting for opponent...
            </div>
        )}
      </div>

      {/* Main Content */}
      {countdown !== null ? (
        <div className="text-center py-20">
            <div className="text-6xl font-black text-f1-red mb-4 animate-ping">{countdown}</div>
            <p className="text-xl text-gray-400">Race Starting...</p>
        </div>
      ) : isRacing ? (
        // Race Visualization
        <div className="bg-black p-6 rounded-lg border border-white/10">
            {currentLog && (
                <div className="text-center">
                    <h3 className="text-xl font-bold mb-8 text-f1-red">{currentLog.nodeName}</h3>
                    
                    {/* Visual Track Position */}
                    <div className="relative h-20 bg-neutral-800 rounded-full mb-8 flex items-center px-4 overflow-hidden">
                        {/* P1 */}
                        <motion.div 
                            className="absolute w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center font-bold text-xs border-2 border-white z-10"
                            animate={{ left: currentLog.gap > 0 ? '60%' : '40%' }} // Simple visual: if gap > 0 (P1 ahead), move right
                        >
                            P1
                        </motion.div>
                        {/* P2 */}
                        <motion.div 
                            className="absolute w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center font-bold text-xs border-2 border-white z-10"
                            animate={{ left: currentLog.gap > 0 ? '40%' : '60%' }}
                        >
                            P2
                        </motion.div>
                        <div className="absolute inset-0 flex items-center justify-center text-neutral-600 font-mono text-sm">
                            Gap: {Math.abs(currentLog.gap).toFixed(3)}s
                        </div>
                    </div>

                    {/* Telemetry */}
                    <div className="grid grid-cols-2 gap-8 text-left">
                        <div>
                            <div className="text-blue-400 font-bold mb-2">Player 1</div>
                            <div className="space-y-1 text-sm font-mono">
                                <div>Speed: {currentLog.p1_speed.toFixed(0)} km/h</div>
                                <div>Batt: {currentLog.p1_battery.toFixed(0)}%</div>
                                <div>Time: {currentLog.p1_time.toFixed(3)}s</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-orange-400 font-bold mb-2">Player 2</div>
                            <div className="space-y-1 text-sm font-mono">
                                <div>Speed: {currentLog.p2_speed.toFixed(0)} km/h</div>
                                <div>Batt: {currentLog.p2_battery.toFixed(0)}%</div>
                                <div>Time: {currentLog.p2_time.toFixed(3)}s</div>
                            </div>
                        </div>
                    </div>

                    {/* Events */}
                    <div className="mt-8 h-12">
                        {currentLog.events.map((e, i) => (
                            <div key={i} className="text-yellow-400 font-bold animate-pulse">{e}</div>
                        ))}
                    </div>

                    {simulationStep >= MONZA_TRACK.length - 1 && (
                        <div className="mt-8 p-4 bg-white/10 rounded-lg">
                            <div className="text-2xl font-black mb-2">
                                {raceResult.winner_id === user?.id ? 'VICTORY!' : 'DEFEAT'}
                            </div>
                            <button onClick={onLeave} className="bg-white text-black px-6 py-2 rounded-full font-bold hover:bg-gray-200">
                                Return to Lobby
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
      ) : (
        // Strategy Selection
        <div>
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Race Strategy</h3>
                <button 
                    onClick={toggleReady}
                    className={`px-8 py-3 rounded-full font-bold flex items-center gap-2 transition-all ${
                        isReady ? 'bg-green-500 text-black hover:bg-green-400' : 'bg-white text-black hover:bg-gray-200'
                    }`}
                >
                    {isReady ? <><Check className="w-5 h-5" /> Ready</> : 'Confirm Strategy'}
                </button>
            </div>

            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                {MONZA_TRACK.map((node) => (
                    <div key={node.id} className="bg-surface p-4 rounded border border-white/5 hover:border-white/10 transition-colors">
                        <div className="flex justify-between items-center mb-3">
                            <span className="font-bold text-gray-300">{node.name}</span>
                            <span className="text-xs text-gray-500 uppercase">{node.type} • {node.length}m</span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            {/* ERS */}
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block flex items-center gap-1"><Zap className="w-3 h-3" /> ERS Mode</label>
                                <select 
                                    className="w-full bg-black border border-white/10 rounded px-2 py-1 text-sm"
                                    value={strategy.ers_per_node[node.id] || 'neutral'}
                                    onChange={(e) => updateStrategy(node.id, 'ers', e.target.value)}
                                    disabled={isReady}
                                >
                                    <option value="neutral">Neutral (Bal)</option>
                                    <option value="hotlap">Hotlap (Speed++)</option>
                                    <option value="overtake">Overtake (Pass++)</option>
                                    <option value="recharge">Recharge (Slow)</option>
                                </select>
                            </div>

                            {/* Line */}
                            <div>
                                <label className="text-xs text-gray-500 mb-1 block flex items-center gap-1"><MousePointer2 className="w-3 h-3" /> Racing Line</label>
                                <select 
                                    className="w-full bg-black border border-white/10 rounded px-2 py-1 text-sm"
                                    value={strategy.line_per_node[node.id] || 'clean'}
                                    onChange={(e) => updateStrategy(node.id, 'line', e.target.value)}
                                    disabled={isReady}
                                >
                                    <option value="clean">Clean Line</option>
                                    <option value="defense">Defensive (Block)</option>
                                    <option value="opportunity">Opportunity (Risk)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
      )}
    </div>
  );
}
