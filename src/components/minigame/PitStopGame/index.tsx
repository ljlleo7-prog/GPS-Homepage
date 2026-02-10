import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useEconomy } from '../../../context/EconomyContext';
import { useAuth } from '../../../context/AuthContext';
import { Trophy, Timer, Play, AlertCircle, Wrench, RotateCcw } from 'lucide-react';
import { PolicyInfo } from '../../common/PolicyInfo';
import GenericLeaderboard from '../GenericLeaderboard';

// Types
type GameState = 
    | 'IDLE' 
    | 'APPROACHING' 
    | 'STOPPED' 
    | 'UNSCREWING' 
    | 'UNSCREWED' 
    | 'TIRE_REMOVED' 
    | 'TIRE_INSTALLED' 
    | 'SCREWING' 
    | 'SCREWED' 
    | 'EXITING' 
    | 'FINISHED';

interface PitStopResult {
    success: boolean;
    reward: number;
    score_ms: number;
    message: string;
    on_cooldown: boolean;
}

export default function PitStopGame() {
    const { t } = useTranslation();
    const { playPitStopGame, wallet } = useEconomy();
    const { user } = useAuth();

    // Tabs
    const [activeTab, setActiveTab] = useState<'GAME' | 'LEADERBOARD'>('GAME');

    const [gameState, setGameState] = useState<GameState>('IDLE');
    const [misalignment, setMisalignment] = useState(0); // pixels
    const [startTime, setStartTime] = useState(0);
    const [finishTime, setFinishTime] = useState(0);
    const [displayTime, setDisplayTime] = useState(0);
    const [nutProgress, setNutProgress] = useState(0); // 0 to 100
    const [oldTirePos, setOldTirePos] = useState({ x: 0, y: 0 });
    const [newTirePos, setNewTirePos] = useState({ x: 150, y: 50 }); // Initial position of new tire
    const [isDragging, setIsDragging] = useState<'OLD' | 'NEW' | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [lastResult, setLastResult] = useState<PitStopResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const gameAreaRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number | null>(null);

    // Constants
    const SCREW_TIME = 500; // ms to screw/unscrew
    const TIRE_TOLERANCE = 30; // px tolerance for installation (generous)
    
    const initializeGame = () => {
        if (!user) {
            setError(t('minigame.login_warning'));
            return;
        }
        if (wallet && wallet.token_balance < 1) {
            setError(t('minigame.cost_warning'));
            return;
        }

        setGameState('APPROACHING');
        setMisalignment((Math.random() * 60) - 30); // +/- 30px variation
        setNutProgress(0);
        setOldTirePos({ x: 0, y: 0 }); // Relative to mount point
        setNewTirePos({ x: 200, y: 0 }); // Initial offset from mount point
        setFinishTime(0);
        setLastResult(null);
        setError(null);
        
        // Simulate Approach
        setTimeout(() => {
            setGameState('STOPPED');
            setStartTime(performance.now());
        }, 1500); // 1.5s approach time
    };

    // --- Interaction Handlers ---

    // 1. Nut Interaction (Unscrew / Screw)
    const handleNutDown = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent drag interference
        if (gameState !== 'STOPPED' && gameState !== 'TIRE_INSTALLED') return;
        
        const start = performance.now();
        const targetState = gameState === 'STOPPED' ? 'UNSCREWED' : 'SCREWED';
        const progressState = gameState === 'STOPPED' ? 'UNSCREWING' : 'SCREWING';
        
        setGameState(progressState);

        const animate = () => {
            const now = performance.now();
            const elapsed = now - start;
            const progress = Math.min((elapsed / SCREW_TIME) * 100, 100);
            setNutProgress(progress);

            if (progress < 100) {
                animationFrameRef.current = requestAnimationFrame(animate);
            } else {
                setGameState(targetState);
                setNutProgress(0);
                
                // If screwed, trigger finish sequence check (handleMouseLeaveCar handles the actual finish)
            }
        };
        animationFrameRef.current = requestAnimationFrame(animate);
    };

    const handleNutUp = () => {
        if (gameState === 'UNSCREWING' || gameState === 'SCREWING') {
            // Cancelled
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            setNutProgress(0);
            setGameState(gameState === 'UNSCREWING' ? 'STOPPED' : 'TIRE_INSTALLED');
        }
    };

    const handleNutLeave = () => {
        handleNutUp(); // Same logic
    };

    // 2. Tire Dragging
    const handleMouseDownTire = (type: 'OLD' | 'NEW', e: React.MouseEvent) => {
        e.stopPropagation();
        if (type === 'OLD' && gameState !== 'UNSCREWED') return;
        if (type === 'NEW' && gameState !== 'TIRE_REMOVED') return;

        setIsDragging(type);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging || !gameAreaRef.current) return;

            const rect = gameAreaRef.current.getBoundingClientRect();
            
            // Mount Point absolute pos (relative to viewport):
            // Center X + misalignment - 80 (wheel offset)
            // Center Y + 40 (wheel offset)
            const mountX = rect.left + (rect.width / 2) + misalignment - 80;
            const mountY = rect.top + (rect.height / 2) + 40;
            
            const relX = e.clientX - mountX;
            const relY = e.clientY - mountY;

            if (isDragging === 'OLD') {
                setOldTirePos({ x: relX, y: relY });
            } else {
                setNewTirePos({ x: relX, y: relY });
            }
        };

        const handleMouseUp = () => {
            if (!isDragging) return;

            if (isDragging === 'OLD') {
                // Check if old tire is clear (dist > 100px)
                const dist = Math.sqrt(oldTirePos.x * oldTirePos.x + oldTirePos.y * oldTirePos.y);
                if (dist > 100) {
                    setGameState('TIRE_REMOVED');
                } else {
                    // Snap back if not far enough
                    setOldTirePos({ x: 0, y: 0 }); 
                }
            } else if (isDragging === 'NEW') {
                // Check if new tire is in target (dist < TOLERANCE)
                const dist = Math.sqrt(newTirePos.x * newTirePos.x + newTirePos.y * newTirePos.y);
                if (dist < TIRE_TOLERANCE) {
                    setNewTirePos({ x: 0, y: 0 }); // Snap
                    setGameState('TIRE_INSTALLED');
                }
            }
            setIsDragging(null);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, misalignment, oldTirePos, newTirePos, gameState]);


    // 3. Game Clear / Exit
    // Triggered manually or by state change?
    // Let's make it automatic after SCREWED
    useEffect(() => {
        if (gameState === 'SCREWED') {
            const end = performance.now();
            const finalTime = end - startTime;
            setFinishTime(finalTime);
            
            // Small delay before exit animation
            setTimeout(() => {
                setGameState('EXITING');
                submitScore(finalTime);
                
                setTimeout(() => {
                    setGameState('FINISHED');
                }, 1000);
            }, 200);
        }
    }, [gameState]);

    // Real-time timer effect
    useEffect(() => {
        let animationFrameId: number;

        const updateTimer = () => {
            if (startTime > 0) {
                const now = performance.now();
                setDisplayTime(now - startTime);
            }
            animationFrameId = requestAnimationFrame(updateTimer);
        };

        if (gameState !== 'IDLE' && gameState !== 'FINISHED' && gameState !== 'APPROACHING') {
            animationFrameId = requestAnimationFrame(updateTimer);
        }

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [gameState, startTime]);

    const submitScore = async (timeMs: number) => {
        setSubmitting(true);
        try {
            const result = await playPitStopGame(Math.round(timeMs));
            
            if (!result.success) throw new Error(result.message);

            setLastResult({
                success: true,
                reward: result.reward || 0,
                score_ms: timeMs,
                message: result.message || 'Success',
                on_cooldown: result.on_cooldown || false
            });
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    // --- Rendering Helpers ---
    
    const CarBody = ({ tirePos }: { tirePos: { x: number, y: number }}) => {
        const mirroredY = { x: tirePos.x, y: -tirePos.y };
        const mirroredX = { x: -tirePos.x, y: tirePos.y };
        const mirroredXY = { x: -tirePos.x, y: -tirePos.y };

        return (
            <g transform={`translate(${misalignment}, 0)`}>
                {/* Main Body */}
                <path d="M -100 -30 L 100 -30 L 120 0 L 100 30 L -100 30 Z" fill="#DC2626" /> 
                {/* Front Wing */}
                <rect x="-140" y="-60" width="40" height="120" fill="#333" rx="5" />
                {/* Rear Wing */}
                <rect x="110" y="-50" width="30" height="100" fill="#333" rx="5" />
                {/* Cockpit */}
                <circle cx="20" cy="0" r="15" fill="#111" />

                {/* Wheels */}
                <g transform={`translate(${mirroredY.x}, ${mirroredY.y})`}>
                    <rect x="-80" y="-70" width="60" height="30" fill="#111" rx="5" /> {/* Front Left */}
                </g>
                <g transform={`translate(${mirroredX.x}, ${mirroredX.y})`}>
                    <rect x="60" y="-70" width="70" height="40" fill="#111" rx="5" /> {/* Rear Right */}
                </g>
                <g transform={`translate(${mirroredXY.x}, ${mirroredXY.y})`}>
                    <rect x="60" y="40" width="70" height="40" fill="#111" rx="5" /> {/* Rear Left */}
                </g>
            </g>
        );
    };

    return (
        <div className="animate-fade-in">
             {/* Header Tabs */}
             <div className="flex justify-center space-x-4 mb-8">
                <button 
                    onClick={() => setActiveTab('GAME')}
                    className={`px-6 py-2 rounded-full font-bold transition-all ${activeTab === 'GAME' ? 'bg-f1-red text-white' : 'bg-surface text-gray-400 hover:bg-neutral-800'}`}
                >
                    {t('minigame.play_game')}
                </button>
                <button 
                    onClick={() => setActiveTab('LEADERBOARD')}
                    className={`px-6 py-2 rounded-full font-bold transition-all ${activeTab === 'LEADERBOARD' ? 'bg-f1-red text-white' : 'bg-surface text-gray-400 hover:bg-neutral-800'}`}
                >
                    {t('minigame.monthly_leaderboard')}
                </button>
            </div>

            {activeTab === 'LEADERBOARD' ? (
                <GenericLeaderboard gameType="PIT_STOP" />
            ) : (
                <div className="w-full max-w-4xl mx-auto p-4">
                    <div className="flex items-center justify-center gap-2 mb-8">
                        <h1 className="text-3xl font-black italic text-f1-red">PIT STOP CHALLENGE</h1>
                        <PolicyInfo titleKey="policies.minigame_title" contentKey="policies.minigame_content" />
                    </div>

                    {/* Header / HUD */}
                    <div className="flex justify-between items-center mb-8">
                        <div>
                            <p className="text-gray-400">Drag to change tires. Hold click to screw/unscrew.</p>
                        </div>
                        <div className="text-right">
                            <div className="text-4xl font-mono font-bold text-f1-red">
                                {gameState === 'IDLE' ? '0.000' : 
                                gameState === 'FINISHED' ? (finishTime / 1000).toFixed(3) : 
                                (displayTime / 1000).toFixed(3)} s
                            </div>
                        </div>
                    </div>

                    {/* Game Area */}
                    <div 
                        ref={gameAreaRef}
                        className="relative h-[400px] bg-neutral-800 rounded-xl overflow-hidden border-2 border-white/10 select-none cursor-crosshair"
                    >
                        {/* Background Grid */}
                        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

                        {/* Car Container */}
                        <motion.div
                            className="absolute top-1/2 left-1/2"
                            initial={{ x: 500 }} // Start off-screen right
                            animate={{ 
                                x: gameState === 'IDLE' ? 500 : 
                                   gameState === 'APPROACHING' ? -100 + misalignment : 
                                   gameState === 'EXITING' ? -900 + misalignment : -100 + misalignment
                            }}
                            transition={{ 
                                type: "spring", 
                                stiffness: 50, 
                                damping: 20,
                                duration: gameState === 'APPROACHING' ? 1.5 : 1 
                            }}
                            style={{ marginTop: -100 }} // Center vertically roughly
                        >
                            <svg width="400" height="300" viewBox="-200 -150 400 300" className="overflow-visible">
                                <CarBody tirePos={isDragging === 'OLD' ? oldTirePos : (isDragging === 'NEW' ? newTirePos : { x: 0, y: 0 })} />
                                
                                {/* Interactive Zone: Front Right Wheel */}
                                {/* Wheel pos relative to car center: x=-80, y=40 */}
                                <g transform={`translate(${misalignment - 80}, 40)`}>
                                    
                                    {/* Mount Point / Hub */}
                                    <circle cx="30" cy="15" r="5" fill="#555" />

                                    {/* Target Zone (Dashed) for New Tire */}
                                    {(gameState === 'TIRE_REMOVED' || gameState === 'TIRE_INSTALLED') && (
                                        <rect 
                                            x="0" y="0" width="60" height="30" 
                                            fill="none" stroke="#FFFF00" strokeWidth="2" strokeDasharray="4 4" 
                                            rx="5"
                                            className="opacity-50"
                                        />
                                    )}

                                    {/* OLD TIRE */}
                                    {gameState !== 'TIRE_REMOVED' && gameState !== 'TIRE_INSTALLED' && gameState !== 'SCREWING' && gameState !== 'SCREWED' && gameState !== 'EXITING' && gameState !== 'FINISHED' && (
                                        <g transform={`translate(${oldTirePos.x}, ${oldTirePos.y})`}>
                                            <rect 
                                                x="0" y="0" width="60" height="30" 
                                                fill={isDragging === 'OLD' ? '#444' : '#222'}
                                                stroke="#FFF"
                                                strokeWidth="2" 
                                                rx="5"
                                                className="cursor-grab active:cursor-grabbing"
                                                onMouseDown={(e) => handleMouseDownTire('OLD', e)}
                                            />
                                            {/* Stripe */}
                                            <rect x="0" y="12" width="60" height="6" fill="#D00" opacity="0.8" pointerEvents="none" />

                                            {/* Nut Indicator */}
                                            {(gameState === 'STOPPED' || gameState === 'UNSCREWING' || gameState === 'UNSCREWED') && (
                                                <g 
                                                    onMouseDown={handleNutDown}
                                                    onMouseUp={handleNutUp}
                                                    onMouseLeave={handleNutLeave}
                                                    className="cursor-pointer hover:scale-110 transition-transform"
                                                >
                                                    <circle cx="30" cy="15" r="8" fill={gameState === 'UNSCREWING' ? '#FFF' : '#EF4444'} />
                                                    {/* Progress Ring */}
                                                    <circle 
                                                        cx="30" cy="15" r="8" 
                                                        fill="transparent" 
                                                        stroke="#22C55E" 
                                                        strokeWidth="3"
                                                        strokeDasharray={`${(nutProgress / 100) * 50} 50`}
                                                        transform="rotate(-90 30 15)"
                                                    />
                                                </g>
                                            )}
                                        </g>
                                    )}

                                    {/* NEW TIRE */}
                                    {(gameState === 'TIRE_REMOVED' || gameState === 'TIRE_INSTALLED' || gameState === 'SCREWING' || gameState === 'SCREWED' || gameState === 'EXITING' || gameState === 'FINISHED') && (
                                        <g transform={`translate(${newTirePos.x}, ${newTirePos.y})`}>
                                            <rect 
                                                x="0" y="0" width="60" height="30" 
                                                fill={isDragging === 'NEW' ? '#444' : '#222'} 
                                                stroke="#FFF"
                                                strokeWidth="2"
                                                rx="5"
                                                className={gameState === 'TIRE_REMOVED' ? "cursor-grab active:cursor-grabbing" : ""}
                                                onMouseDown={(e) => handleMouseDownTire('NEW', e)}
                                            />
                                            {/* Stripe */}
                                            <rect x="0" y="12" width="60" height="6" fill="#D00" opacity="0.8" pointerEvents="none" />
                                            
                                            {/* Nut Indicator (Install) */}
                                            {(gameState === 'TIRE_INSTALLED' || gameState === 'SCREWING') && (
                                                <g 
                                                    onMouseDown={handleNutDown}
                                                    onMouseUp={handleNutUp}
                                                    onMouseLeave={handleNutLeave}
                                                    className="cursor-pointer hover:scale-110 transition-transform"
                                                >
                                                    <circle cx="30" cy="15" r="8" fill={gameState === 'SCREWING' ? '#FFF' : '#EF4444'} />
                                                    <circle 
                                                        cx="30" cy="15" r="8" 
                                                        fill="transparent" 
                                                        stroke="#22C55E" 
                                                        strokeWidth="3"
                                                        strokeDasharray={`${(nutProgress / 100) * 50} 50`}
                                                        transform="rotate(-90 30 15)"
                                                    />
                                                </g>
                                            )}
                                            
                                            {/* Secured Indicator */}
                                            {(gameState === 'SCREWED' || gameState === 'EXITING' || gameState === 'FINISHED') && (
                                                <circle cx="30" cy="15" r="6" fill="#22C55E" />
                                            )}
                                        </g>
                                    )}

                                </g>
                            </svg>
                        </motion.div>

                        {/* Overlays */}
                        <AnimatePresence>
                            {gameState === 'IDLE' && (
                                <motion.div 
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                    className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10"
                                >
                                    <div className="text-center p-8 bg-neutral-900 rounded-2xl border border-white/10 max-w-md">
                                        <Wrench className="w-12 h-12 text-f1-red mx-auto mb-4" />
                                        <h2 className="text-2xl font-bold mb-2">Ready to Pit?</h2>
                                        <p className="text-gray-400 mb-6">
                                            Cost: <span className="text-white font-bold">1 Token</span><br/>
                                            Change the front-right tire as fast as possible.
                                        </p>
                                        {error && (
                                            <div className="mb-4 p-3 bg-red-500/20 text-red-200 rounded-lg flex items-center gap-2 text-sm">
                                                <AlertCircle className="w-4 h-4" />
                                                {error}
                                            </div>
                                        )}
                                        <button 
                                            onClick={initializeGame}
                                            className="px-8 py-3 bg-f1-red text-white font-bold rounded-full hover:bg-red-700 transition-colors flex items-center gap-2 mx-auto"
                                        >
                                            <Play className="w-5 h-5" />
                                            START ENGINE
                                        </button>
                                    </div>
                                </motion.div>
                            )}

                            {gameState === 'FINISHED' && lastResult && (
                                <motion.div 
                                    initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                                    className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-20"
                                >
                                    <div className="text-center p-8 bg-neutral-900 rounded-2xl border border-white/10 max-w-md w-full mx-4 shadow-2xl shadow-f1-red/20">
                                        <div className="mb-2 text-f1-red font-mono text-5xl font-black tracking-tighter">
                                            {(lastResult.score_ms / 1000).toFixed(3)}s
                                        </div>
                                        <div className="text-gray-400 mb-6 uppercase tracking-widest text-sm">Pit Stop Time</div>

                                        <div className="space-y-4 mb-8">
                                            {lastResult.reward > 0 ? (
                                                <div className="p-4 bg-green-500/20 rounded-xl border border-green-500/20">
                                                    <div className="text-green-400 text-sm font-bold uppercase mb-1">Reward Earned</div>
                                                    <div className="text-3xl font-bold text-white flex items-center justify-center gap-2">
                                                        +{lastResult.reward} <span className="text-sm opacity-50">TOKENS</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                                    <div className="text-gray-400 text-sm mb-1">
                                                        {lastResult.on_cooldown ? 'Cooldown Active' : 'Too Slow'}
                                                    </div>
                                                    <div className="text-sm text-gray-500">
                                                        {lastResult.on_cooldown ? 'Come back later for rewards' : 'Sub-4.000s needed for reward'}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex gap-3">
                                            <button 
                                                onClick={() => setGameState('IDLE')}
                                                className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-colors"
                                            >
                                                Menu
                                            </button>
                                            <button 
                                                onClick={initializeGame}
                                                className="flex-1 px-4 py-3 bg-f1-red hover:bg-red-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                                            >
                                                <RotateCcw className="w-4 h-4" />
                                                Retry (1 Token)
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    
                    {/* Instructions */}
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-center text-sm text-gray-500">
                        <div className="p-4 bg-neutral-800 rounded-xl border border-white/5">
                            <strong className="block text-white mb-1">1. UNSCREW</strong>
                            Hold click on the red nut until it turns green.
                        </div>
                        <div className="p-4 bg-neutral-800 rounded-xl border border-white/5">
                            <strong className="block text-white mb-1">2. SWAP</strong>
                            Drag the old tire away, then drag the new tire onto the hub.
                        </div>
                        <div className="p-4 bg-neutral-800 rounded-xl border border-white/5">
                            <strong className="block text-white mb-1">3. SECURE</strong>
                            Hold click on the nut again to secure the wheel.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}