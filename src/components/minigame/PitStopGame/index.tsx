import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useEconomy } from '../../../context/EconomyContext';
import { useAuth } from '../../../context/AuthContext';
import { Play, AlertCircle, Wrench, RotateCcw } from 'lucide-react';
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
    const [newTirePos, setNewTirePos] = useState({ x: 40, y: 50 }); // Initial position of new tire
    const [isDragging, setIsDragging] = useState<'OLD' | 'NEW' | null>(null);
    const [dragStartOffset, setDragStartOffset] = useState({ x: 0, y: 0 });
    const [lastResult, setLastResult] = useState<PitStopResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const gameAreaRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number | null>(null);

    // Constants
    const SCREW_TIME = 500; // ms to screw/unscrew
    const TIRE_TOLERANCE = 20; // px tolerance for installation (generous)
    const PIT_ALIGN_X = -100;
    const PIT_ALIGN_Y = -100;
    const CAR_SCALE = 1.4;
    const WHEEL_POSITIONS = {
        frontLeft: { x: -80, y: -50 },
        rearLeft: { x: 70, y: -45 },
        rearRight: { x: 70, y: 45 },
        frontRight: { x: -80, y: 50 }
    };
    const GRID_WHEEL_POSITIONS = {
        frontLeft: { x: WHEEL_POSITIONS.frontLeft.x * CAR_SCALE, y: WHEEL_POSITIONS.frontLeft.y * CAR_SCALE },
        rearLeft: { x: WHEEL_POSITIONS.rearLeft.x * CAR_SCALE, y: WHEEL_POSITIONS.rearLeft.y * CAR_SCALE },
        rearRight: { x: WHEEL_POSITIONS.rearRight.x * CAR_SCALE, y: WHEEL_POSITIONS.rearRight.y * CAR_SCALE },
        frontRight: { x: WHEEL_POSITIONS.frontRight.x * CAR_SCALE, y: WHEEL_POSITIONS.frontRight.y * CAR_SCALE }
    };
    const TIRE_WIDTH = 60;
    const TIRE_HEIGHT = 30;
    const TIRE_WIDTH_INNER = TIRE_WIDTH / CAR_SCALE;
    const TIRE_HEIGHT_INNER = TIRE_HEIGHT / CAR_SCALE;
    const TIRE_HALF_WIDTH = TIRE_WIDTH / 2;
    const TIRE_HALF_HEIGHT = TIRE_HEIGHT / 2;
    const TIRE_HALF_WIDTH_INNER = TIRE_WIDTH_INNER / 2;
    const TIRE_HALF_HEIGHT_INNER = TIRE_HEIGHT_INNER / 2;
    const TIRE_STRIPE_HEIGHT = 6;
    const TIRE_STRIPE_HEIGHT_INNER = TIRE_STRIPE_HEIGHT / CAR_SCALE;
    const TIRE_STRIPE_OFFSET = TIRE_STRIPE_HEIGHT / 2;
    const TIRE_STRIPE_OFFSET_INNER = TIRE_STRIPE_HEIGHT_INNER / 2;
    const TARGET_CROSS_X = TIRE_HALF_WIDTH + 10;
    const TARGET_CROSS_Y = TIRE_HALF_HEIGHT + 10;
    
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
        setMisalignment((Math.random() * 20) - 10);
        setNutProgress(0);
        setOldTirePos({ x: 0, y: 0 }); // Relative to mount point
        setNewTirePos({ x: 40, y: 50 }); // Initial offset from mount point
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
        if (gameState === 'STOPPED' || (gameState === 'APPROACHING' && nutProgress === 0) || gameState === 'TIRE_INSTALLED') {
            // Allow unscrewing during approach, but not re-screwing
            if (gameState === 'APPROACHING' && nutProgress > 0) return;
        } else {
            return;
        }
        
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

        const tirePos = type === 'OLD' ? oldTirePos : newTirePos;
        setDragStartOffset({
            x: e.clientX - tirePos.x,
            y: e.clientY - tirePos.y
        });
        setIsDragging(type);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging || !gameAreaRef.current) return;

            // Mount Point absolute pos (relative to viewport):
            // Center X + misalignment - 80 (wheel offset)
            // Center Y + 40 (wheel offset)
            const newX = e.clientX - dragStartOffset.x;
            const newY = e.clientY - dragStartOffset.y;

            if (isDragging === 'OLD') {
                setOldTirePos({ x: newX, y: newY });
            } else {
                setNewTirePos({ x: newX, y: newY });
            }
        };

        const handleMouseUp = () => {
            if (!isDragging) return;

            if (isDragging === 'OLD') {
                // Check if old tire is clear (dist > 60px)
                const dist = Math.sqrt(oldTirePos.x * oldTirePos.x + oldTirePos.y * oldTirePos.y);
                if (dist > 60) {
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
            setDisplayTime(finalTime);
            submitScore(finalTime);
            setGameState('EXITING');
            setTimeout(() => {
                setGameState('FINISHED');
            }, 1000);
        }
    }, [gameState, startTime]);

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

        if (gameState !== 'IDLE' && gameState !== 'FINISHED' && gameState !== 'APPROACHING' && gameState !== 'EXITING' && gameState !== 'SCREWED') {
            animationFrameId = requestAnimationFrame(updateTimer);
        }

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [gameState, startTime]);

    const submitScore = async (timeMs: number) => {
        try {
            const result = await playPitStopGame(Math.round(timeMs));
            
            if (!result.success) throw new Error(result.message);

            setLastResult({
                success: true,
                reward: result.reward || 0,
                score_ms: timeMs,
                message: result.message || 'Success'
            });
        } catch (err: any) {
            setError(err.message);
        } finally {
        }
    };

    // --- Rendering Helpers ---
    
    const CarBody = () => {
        return (
            <g transform={`scale(${CAR_SCALE})`}>
                {/* Shadow */}
                <ellipse cx="0" cy="0" rx="140" ry="60" fill="#000" opacity="0.3" />
                
                {/* Rear Wing */}
                <g transform="translate(110, 0)">
                     <rect x="-10" y="-55" width="20" height="110" fill="#1F2937" rx="2" />
                     <path d="M -10 -55 L 10 -55 L 10 55 L -10 55 Z" fill="#374151" />
                     {/* Flaps */}
                     <line x1="-10" y1="-30" x2="10" y2="-30" stroke="#4B5563" strokeWidth="1" />
                     <line x1="-10" y1="30" x2="10" y2="30" stroke="#4B5563" strokeWidth="1" />
                     {/* Endplates */}
                     <path d="M -10 -55 L 30 -55 L 30 -50 L -10 -50 Z" fill="#DC2626" />
                     <path d="M -10 50 L 30 50 L 30 55 L -10 55 Z" fill="#DC2626" />
                </g>

                {/* Main Body - Cola Bottle */}
                <path d="
                    M -150 -10 
                    L -50 -15 L -40 -35 L 40 -35 L 80 -20 L 120 -5
                    L 120 5 L 80 20 L 40 35 L -40 35 L -50 15 
                    L -150 10 Z
                " fill="#DC2626" stroke="#991B1B" strokeWidth="2" />
                
                {/* Engine Cover */}
                <path d="M -40 -8 L 100 0 L -40 8 Z" fill="#B91C1C" />
                
                {/* Sidepod Inlets */}
                <path d="M -40 -35 L -20 -35 L -20 -25 L -40 -15 Z" fill="#111" />
                <path d="M -40 35 L -20 35 L -20 25 L -40 15 Z" fill="#111" />

                {/* Cockpit / Halo */}
                <circle cx="-10" cy="0" r="14" fill="#111" stroke="#374151" strokeWidth="3" />
                <path d="M -20 -10 L 10 0 L -20 10" fill="none" stroke="#DC2626" strokeWidth="2" />

                {/* Front Wing */}
                <g transform="translate(-160, 0)">
                    <path d="M 0 -65 L 20 -60 L 15 0 L 20 60 L 0 65 Q -15 0 0 -65 Z" fill="#1F2937" />
                    <path d="M 5 -62 L 18 -58" stroke="#4B5563" />
                    <path d="M 5 62 L 18 58" stroke="#4B5563" />
                </g>

                <g transform={`translate(${WHEEL_POSITIONS.frontLeft.x}, ${WHEEL_POSITIONS.frontLeft.y})`}>
                    <rect x={-TIRE_HALF_WIDTH_INNER} y={-TIRE_HALF_HEIGHT_INNER} width={TIRE_WIDTH_INNER} height={TIRE_HEIGHT_INNER} fill="#111" rx="4" />
                    <rect x={-TIRE_HALF_WIDTH_INNER} y={-TIRE_STRIPE_OFFSET_INNER} width={TIRE_WIDTH_INNER} height={TIRE_STRIPE_HEIGHT_INNER} fill="#D00" opacity="0.8" />
                </g>
                <g transform={`translate(${WHEEL_POSITIONS.rearRight.x}, ${WHEEL_POSITIONS.rearRight.y})`}>
                    <rect x={-TIRE_HALF_WIDTH_INNER} y={-TIRE_HALF_HEIGHT_INNER} width={TIRE_WIDTH_INNER} height={TIRE_HEIGHT_INNER} fill="#111" rx="4" />
                    <rect x={-TIRE_HALF_WIDTH_INNER} y={-TIRE_STRIPE_OFFSET_INNER} width={TIRE_WIDTH_INNER} height={TIRE_STRIPE_HEIGHT_INNER} fill="#D00" opacity="0.8" />
                </g>
                <g transform={`translate(${WHEEL_POSITIONS.rearLeft.x}, ${WHEEL_POSITIONS.rearLeft.y})`}>
                    <rect x={-TIRE_HALF_WIDTH_INNER} y={-TIRE_HALF_HEIGHT_INNER} width={TIRE_WIDTH_INNER} height={TIRE_HEIGHT_INNER} fill="#111" rx="4" />
                    <rect x={-TIRE_HALF_WIDTH_INNER} y={-TIRE_STRIPE_OFFSET_INNER} width={TIRE_WIDTH_INNER} height={TIRE_STRIPE_HEIGHT_INNER} fill="#D00" opacity="0.8" />
                </g>

                {/* Front Right Axle (Bottom) - Tire is interactive */}
                <g transform={`translate(${WHEEL_POSITIONS.frontRight.x}, ${WHEEL_POSITIONS.frontRight.y})`}>
                    <circle cx="0" cy="0" r="4" fill="#333" stroke="#666" strokeWidth="1" />
                    {/* Brake Disc */}
                    <circle cx="0" cy="0" r="8" fill="none" stroke="#333" strokeWidth="1" strokeDasharray="2 2" />
                </g>
            </g>
        );
    };

    const PitGrid = () => (
        <div 
            className="absolute top-1/2 left-1/2 pointer-events-none"
            style={{ transform: `translate(calc(-17% + ${PIT_ALIGN_X}px), calc(-13% + ${PIT_ALIGN_Y}px))` }}
        >
             <svg width="600" height="400" viewBox="-300 -200 600 400" className="opacity-40">
                {/* Pit Box Box */}
                <rect x="-200" y="-100" width="400" height="200" fill="none" stroke="#FFFF00" strokeWidth="2" strokeDasharray="10 5" />
                
                {/* Wheel Targets */}
                {/* Front Right (Interactive) Target - Matches new car scale 1.4 */}
                {/* Pos: -80 * 1.4 = -112, 50 * 1.4 = 70 */}
                <g transform={`translate(${GRID_WHEEL_POSITIONS.frontRight.x}, ${GRID_WHEEL_POSITIONS.frontRight.y})`}>
                    <rect x={-TIRE_HALF_WIDTH} y={-TIRE_HALF_HEIGHT} width={TIRE_WIDTH} height={TIRE_HEIGHT} fill="none" stroke="#00FF00" strokeWidth="2" />
                    <line x1={-TARGET_CROSS_X} y1="0" x2={TARGET_CROSS_X} y2="0" stroke="#00FF00" strokeWidth="1" />
                    <line x1="0" y1={-TARGET_CROSS_Y} x2="0" y2={TARGET_CROSS_Y} stroke="#00FF00" strokeWidth="1" />
                </g>

                {/* Other Wheels (Visual only) */}
                <rect x={GRID_WHEEL_POSITIONS.frontLeft.x - TIRE_HALF_WIDTH} y={GRID_WHEEL_POSITIONS.frontLeft.y - TIRE_HALF_HEIGHT} width={TIRE_WIDTH} height={TIRE_HEIGHT} fill="none" stroke="#FFFF00" strokeWidth="1" opacity="0.5" />
                <rect x={GRID_WHEEL_POSITIONS.rearRight.x - TIRE_HALF_WIDTH} y={GRID_WHEEL_POSITIONS.rearRight.y - TIRE_HALF_HEIGHT} width={TIRE_WIDTH} height={TIRE_HEIGHT} fill="none" stroke="#FFFF00" strokeWidth="1" opacity="0.5" />
                <rect x={GRID_WHEEL_POSITIONS.rearLeft.x - TIRE_HALF_WIDTH} y={GRID_WHEEL_POSITIONS.rearLeft.y - TIRE_HALF_HEIGHT} width={TIRE_WIDTH} height={TIRE_HEIGHT} fill="none" stroke="#FFFF00" strokeWidth="1" opacity="0.5" />
             </svg>
        </div>
    );

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
                        <h1 className="text-3xl font-black italic text-f1-red">{t('minigame.pit_stop.title')}</h1>
                        <PolicyInfo titleKey="policies.minigame_title" contentKey="policies.minigame_content" />
                    </div>

                    {/* Header / HUD */}
                    <div className="flex justify-between items-center mb-8">
                        <div>
                            <p className="text-gray-400">{t('minigame.pit_stop.instructions')}</p>
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
                        
                        <PitGrid />

                        {/* Car Container */}
                        {gameState !== 'FINISHED' && (
                        <motion.div
                            className="absolute top-1/2 left-1/2"
                            initial={{ x: 500, y: PIT_ALIGN_Y }}
                            animate={{ 
                                x: gameState === 'IDLE' ? 500 : 
                                   gameState === 'APPROACHING' ? PIT_ALIGN_X + misalignment : 
                                   gameState === 'EXITING' ? PIT_ALIGN_X - 800 + misalignment : PIT_ALIGN_X + misalignment,
                                y: PIT_ALIGN_Y
                            }}
                            transition={{ 
                                type: "spring", 
                                stiffness: 50, 
                                damping: 20,
                                duration: gameState === 'APPROACHING' ? 1.5 : 1 
                            }}
                        >
                            <svg width="400" height="300" viewBox="-200 -150 400 300" className="overflow-visible">
                                <CarBody />
                                
                                <g transform={`translate(${GRID_WHEEL_POSITIONS.frontRight.x}, ${GRID_WHEEL_POSITIONS.frontRight.y})`}>
                                    <circle cx="0" cy="0" r="5" fill="#555" />

                                    {/* Target Zone (Dashed) for New Tire */}
                                    {(gameState === 'TIRE_REMOVED' || gameState === 'TIRE_INSTALLED') && (
                                        <rect 
                                            x={-TIRE_HALF_WIDTH} y={-TIRE_HALF_HEIGHT} width={TIRE_WIDTH} height={TIRE_HEIGHT} 
                                            fill="none" stroke="#FFFF00" strokeWidth="2" strokeDasharray="4 4" 
                                            rx="5"
                                            className="opacity-50"
                                        />
                                    )}

                                    <g transform={`translate(${oldTirePos.x}, ${oldTirePos.y})`}>
                                        <rect 
                                            x={-TIRE_HALF_WIDTH} y={-TIRE_HALF_HEIGHT} width={TIRE_WIDTH} height={TIRE_HEIGHT} 
                                            fill={isDragging === 'OLD' ? '#444' : '#222'}
                                            stroke="#FFF"
                                            strokeWidth="2" 
                                            rx="5"
                                            className="cursor-grab active:cursor-grabbing"
                                            onMouseDown={(e) => handleMouseDownTire('OLD', e)}
                                        />
                                        <rect x={-TIRE_HALF_WIDTH} y={-TIRE_STRIPE_OFFSET} width={TIRE_WIDTH} height={TIRE_STRIPE_HEIGHT} fill="#D00" opacity="0.8" pointerEvents="none" />

                                        {(gameState === 'STOPPED' || gameState === 'UNSCREWING' || gameState === 'UNSCREWED') && (
                                                <g 
                                                    onMouseDown={handleNutDown}
                                                    onMouseUp={handleNutUp}
                                                    onMouseLeave={handleNutLeave}
                                                    className="cursor-pointer hover:scale-110 transition-transform"
                                                >
                                                    <circle
                                                        cx="0"
                                                        cy="0"
                                                        r="8"
                                                        fill={
                                                            gameState === 'UNSCREWING'
                                                                ? '#FFFFFF'
                                                                : gameState === 'UNSCREWED'
                                                                ? '#22C55E'
                                                                : '#EF4444'
                                                        }
                                                    />
                                                    <circle 
                                                        cx="0" cy="0" r="8" 
                                                        fill="transparent" 
                                                        stroke="#22C55E" 
                                                        strokeWidth="3"
                                                        strokeDasharray={`${(nutProgress / 100) * 50} 50`}
                                                        transform="rotate(-90 0 0)"
                                                    />
                                                </g>
                                            )}
                                        </g>

                                    <g transform={`translate(${newTirePos.x}, ${newTirePos.y})`}>
                                        <rect 
                                            x={-TIRE_HALF_WIDTH} y={-TIRE_HALF_HEIGHT} width={TIRE_WIDTH} height={TIRE_HEIGHT} 
                                            fill={isDragging === 'NEW' ? '#444' : '#222'} 
                                            stroke="#FFF"
                                            strokeWidth="2"
                                            rx="5"
                                            className={gameState === 'TIRE_REMOVED' ? "cursor-grab active:cursor-grabbing" : ""}
                                            onMouseDown={(e) => handleMouseDownTire('NEW', e)}
                                        />
                                        <rect x={-TIRE_HALF_WIDTH} y={-TIRE_STRIPE_OFFSET} width={TIRE_WIDTH} height={TIRE_STRIPE_HEIGHT} fill="#D00" opacity="0.8" pointerEvents="none" />
                                        
                                        {(gameState === 'TIRE_INSTALLED' || gameState === 'SCREWING') && (
                                                <g 
                                                    onMouseDown={handleNutDown}
                                                    onMouseUp={handleNutUp}
                                                    onMouseLeave={handleNutLeave}
                                                    className="cursor-pointer hover:scale-110 transition-transform"
                                                >
                                                    <circle
                                                        cx="0"
                                                        cy="0"
                                                        r="8"
                                                        fill={
                                                            gameState === 'SCREWING'
                                                                ? '#FFFFFF'
                                                                : gameState === 'TIRE_INSTALLED'
                                                                ? '#22C55E'
                                                                : '#EF4444'
                                                        }
                                                    />
                                                    <circle 
                                                        cx="0" cy="0" r="8" 
                                                        fill="transparent" 
                                                        stroke="#22C55E" 
                                                        strokeWidth="3"
                                                        strokeDasharray={`${(nutProgress / 100) * 50} 50`}
                                                        transform="rotate(-90 0 0)"
                                                    />
                                                </g>
                                            )}
                                            
                                            {(gameState === 'SCREWED' || gameState === 'EXITING') && (
                                                <circle cx="0" cy="0" r="6" fill="#22C55E" />
                                            )}
                                        </g>
                                </g>
                            </svg>
                        </motion.div>
                        )}

                        {/* Overlays */}
                        <AnimatePresence>
                            {gameState === 'IDLE' && (
                                <motion.div 
                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                    className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10"
                                >
                                    <div className="text-center p-8 bg-neutral-900 rounded-2xl border border-white/10 max-w-md">
                                        <Wrench className="w-12 h-12 text-f1-red mx-auto mb-4" />
                                        <h2 className="text-2xl font-bold mb-2">{t('minigame.pit_stop.ready_title')}</h2>
                                        <p className="text-gray-400 mb-6">
                                            {t('minigame.pit_stop.cost_label')} <span className="text-white font-bold">{t('minigame.pit_stop.cost_value')}</span><br/>
                                            {t('minigame.pit_stop.objective')}
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
                                            {t('minigame.pit_stop.start_engine')}
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
                                        <div className="text-gray-400 mb-6 uppercase tracking-widest text-sm">{t('minigame.pit_stop.result_time')}</div>

                                        <div className="space-y-4 mb-8">
                                            {lastResult.reward > 0 ? (
                                                <div className="p-4 bg-green-500/20 rounded-xl border border-green-500/20">
                                                    <div className="text-green-400 text-sm font-bold uppercase mb-1">{t('minigame.pit_stop.reward_earned')}</div>
                                                    <div className="text-3xl font-bold text-white flex items-center justify-center gap-2">
                                                        +{lastResult.reward} <span className="text-sm opacity-50">TOKENS</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                                    <div className="text-gray-400 text-sm mb-1">
                                                        {t('minigame.pit_stop.too_slow')}
                                                    </div>
                                                    <div className="text-sm text-gray-500">
                                                        {t('minigame.pit_stop.reward_threshold')}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex gap-3">
                                            <button 
                                                onClick={() => setGameState('IDLE')}
                                                className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-colors"
                                            >
                                                {t('minigame.pit_stop.menu')}
                                            </button>
                                            <button 
                                                onClick={initializeGame}
                                                className="flex-1 px-4 py-3 bg-f1-red hover:bg-red-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                                            >
                                                <RotateCcw className="w-4 h-4" />
                                                {t('minigame.pit_stop.retry')}
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
                            <strong className="block text-white mb-1">{t('minigame.pit_stop.step1_title')}</strong>
                            {t('minigame.pit_stop.step1_desc')}
                        </div>
                        <div className="p-4 bg-neutral-800 rounded-xl border border-white/5">
                            <strong className="block text-white mb-1">{t('minigame.pit_stop.step2_title')}</strong>
                            {t('minigame.pit_stop.step2_desc')}
                        </div>
                        <div className="p-4 bg-neutral-800 rounded-xl border border-white/5">
                            <strong className="block text-white mb-1">{t('minigame.pit_stop.step3_title')}</strong>
                            {t('minigame.pit_stop.step3_desc')}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
