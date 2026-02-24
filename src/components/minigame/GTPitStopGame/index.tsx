import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useEconomy } from '../../../context/EconomyContext';
import { useAuth } from '../../../context/AuthContext';
import { Wrench, RotateCcw, Play, AlertCircle, CheckCircle } from 'lucide-react';
import GenericLeaderboard from '../GenericLeaderboard';
import { PolicyInfo } from '../../common/PolicyInfo';

type WheelKey = 'FL' | 'FR' | 'RL' | 'RR';

interface WheelState {
  boltsUnscrewed: number; // 0-5
  removed: boolean;
  installed: boolean;
  boltsSecured: number; // 0-5
}

export default function GTPitStopGame() {
  const { t } = useTranslation();
  const { playGTPitStopGame } = useEconomy();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<'GAME' | 'LEADERBOARD'>('GAME');

  const [startTime, setStartTime] = useState(0);
  const [finishTime, setFinishTime] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [approaching, setApproaching] = useState(false);
  const [parked, setParked] = useState(false);
  const [leftDoorAngle, setLeftDoorAngle] = useState(0);
  const [rightDoorAngle, setRightDoorAngle] = useState(0);
  const [doorOpen, setDoorOpen] = useState(false);
  const [driverOut, setDriverOut] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [jackTaken, setJackTaken] = useState(false);
  const [jackRaised, setJackRaised] = useState(false);
  const [jackLowered, setJackLowered] = useState(false);
  const [driverIn, setDriverIn] = useState(false);
  const [doorClosed, setDoorClosed] = useState(false);
  const [manualStartReady, setManualStartReady] = useState(false);
  const [finished, setFinished] = useState(false);

  const [wheelState, setWheelState] = useState<Record<WheelKey, WheelState>>({
    FL: { boltsUnscrewed: 0, removed: false, installed: false, boltsSecured: 0 },
    FR: { boltsUnscrewed: 0, removed: false, installed: false, boltsSecured: 0 },
    RL: { boltsUnscrewed: 0, removed: false, installed: false, boltsSecured: 0 },
    RR: { boltsUnscrewed: 0, removed: false, installed: false, boltsSecured: 0 },
  });
  const [wheelLoosePos, setWheelLoosePos] = useState<Partial<Record<WheelKey, { x: number; y: number }>>>({});
  const [newTireDrag, setNewTireDrag] = useState<null | { x: number; y: number }>(null);
  const [newTiresInStorage, setNewTiresInStorage] = useState(4);
  const [looseOldTires, setLooseOldTires] = useState(0);

  const [driverPos, setDriverPos] = useState({ x: -40, y: -10 });
  const [jackPos, setJackPos] = useState({ x: -120, y: 40 });
  const [storageDoorOffset, setStorageDoorOffset] = useState(0);

  const gameAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;
    const loop = () => {
      if (startTime && !finished) {
        const now = performance.now();
        setDisplayTime(now - startTime);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [startTime, finished]);

  const resetGame = () => {
    setApproaching(false);
    setParked(false);
    setLeftDoorAngle(0);
    setRightDoorAngle(0);
    setDoorOpen(false);
    setDriverOut(false);
    setStorageOpen(false);
    setJackTaken(false);
    setJackRaised(false);
    setJackLowered(false);
    setDriverIn(false);
    setDoorClosed(false);
    setManualStartReady(false);
    setFinished(false);
    setWheelState({
      FL: { boltsUnscrewed: 0, removed: false, installed: false, boltsSecured: 0 },
      FR: { boltsUnscrewed: 0, removed: false, installed: false, boltsSecured: 0 },
      RL: { boltsUnscrewed: 0, removed: false, installed: false, boltsSecured: 0 },
      RR: { boltsUnscrewed: 0, removed: false, installed: false, boltsSecured: 0 },
    });
    setNewTiresInStorage(4);
    setLooseOldTires(0);
    setDriverPos({ x: -40, y: -10 });
    setJackPos({ x: -120, y: 40 });
    setStorageDoorOffset(0);
    setStartTime(0);
    setFinishTime(0);
    setDisplayTime(0);
    setError(null);
    setSubmitting(false);
  };

  const startSequence = () => {
    if (!user) { setError(t('minigame.login_warning')); return; }
    resetGame();
    setApproaching(true);
    setTimeout(() => {
      setApproaching(false);
      setParked(true);
      setStartTime(performance.now());
    }, 1200);
  };

  useEffect(() => {
    const allChanged = (['FL', 'FR', 'RL', 'RR'] as WheelKey[]).every(k => wheelState[k].installed && wheelState[k].boltsSecured === 5);
    if (allChanged && jackLowered && jackTaken && storageOpen && driverIn && doorClosed) {
      setManualStartReady(true);
    } else {
      setManualStartReady(false);
    }
  }, [wheelState, jackLowered, jackTaken, storageOpen, driverIn, doorClosed]);

  const completeAndSubmit = async () => {
    if (!manualStartReady) return;
    setFinished(true);
    const end = performance.now();
    const final = end - startTime;
    setFinishTime(final);
    setSubmitting(true);
    try {
      const result = await playGTPitStopGame(Math.round(final));
      if (!result.success) throw new Error(result.message);
    } catch (e) {
      if (e instanceof Error) {
        setError(e.message || 'Failed to submit');
      } else {
        setError('Failed to submit');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDoorDrag = (e: React.MouseEvent, side: 'left' | 'right') => {
    if (!parked) return;
    const startX = e.clientX;
    const startAngle = side === 'left' ? leftDoorAngle : rightDoorAngle;
    
    const onMove = (ev: MouseEvent) => {
      let angle = 0;
      if (side === 'left') {
          const deltaX = (startX - ev.clientX); // drag left to open
          angle = Math.max(0, Math.min(75, startAngle + deltaX * 0.5));
          setLeftDoorAngle(angle);
      } else {
          const deltaX = (ev.clientX - startX); // drag right to open
          angle = Math.max(0, Math.min(75, startAngle + deltaX * 0.5));
          setRightDoorAngle(angle);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const openLeft = leftDoorAngle > 45;
      const openRight = rightDoorAngle > 45;
      const isOpen = openLeft || openRight;
      setDoorOpen(isOpen);
      if (!isOpen && leftDoorAngle === 0 && rightDoorAngle === 0 && driverIn) setDoorClosed(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleStorageDoorDrag = (e: React.MouseEvent) => {
    if (!parked) return;
    const startY = e.clientY;
    const startOffset = storageDoorOffset;
    const onMove = (ev: MouseEvent) => {
      // Dragging Up (-Y) increases offset (opens hatch)
      // Visual: Offset 0 = Closed. Offset > 0 = Hatch slides "back" or "up" visually.
      // Let's say offset 0-60px.
      const delta = startY - ev.clientY;
      setStorageDoorOffset(Math.max(0, Math.min(60, startOffset + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (storageDoorOffset > 40) setStorageOpen(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };


  const dragDriver = (e: React.MouseEvent) => {
    if (!doorOpen) return;
    const startX = e.clientX, startY = e.clientY;
    const start = { ...driverPos };
    const onMove = (ev: MouseEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;
      setDriverPos({ 
          x: start.x + deltaX, 
          y: start.y + deltaY 
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (driverPos.x > 40) setDriverOut(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const dragJack = (e: React.MouseEvent) => {
    if (!storageOpen) return;
    const startX = e.clientX, startY = e.clientY;
    const start = { ...jackPos };
    const onMove = (ev: MouseEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;
      setJackPos({ 
          x: start.x + deltaX, 
          y: start.y + deltaY 
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const dx = jackPos.x - (-150);
      const dy = jackPos.y - (-20);
      if (Math.hypot(dx, dy) > 40) setJackTaken(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const dragTireFromStorage = (e: React.MouseEvent, index: number) => {
    if (!storageOpen || newTiresInStorage <= 0 || newTireDrag) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { x: -150, y: 10 + index * 8 };
    setNewTireDrag(startPos);
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setNewTireDrag(prev => prev ? { x: prev.x + dx, y: prev.y + dy } : null);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const targets: Array<{ key: WheelKey; x: number; y: number }> = [
        { key: 'RL', x: -140, y: 55 },
        { key: 'RR', x: -140, y: -55 },
        { key: 'FL', x: 140, y: 55 },
        { key: 'FR', x: 140, y: -55 },
      ];
      const pos = newTireDrag;
      if (pos) {
        for (const t of targets) {
          const dx = (pos.x - t.x);
          const dy = (pos.y - t.y);
          const d = Math.hypot(dx, dy);
          if (d < 24 && wheelState[t.key].removed && !wheelState[t.key].installed) {
            setWheelState(prev => ({ ...prev, [t.key]: { ...prev[t.key], installed: true } }));
            setNewTiresInStorage(v => Math.max(0, v - 1));
            break;
          }
        }
      }
      setNewTireDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const toggleJackLever = () => {
    if (!jackTaken) return;
    if (!jackRaised) {
      setJackRaised(true);
      setJackLowered(false);
    } else {
      setJackRaised(false);
      setJackLowered(true);
    }
  };

  const holdAction = (wheel: WheelKey, kind: 'unscrew' | 'secure') => {
    if (!jackRaised) return;
    let active = true;
    const onUp = () => {
      active = false;
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mouseup', onUp);
    const start = performance.now();
    const duration = 1000;
    const tick = () => {
      if (!active) return;
      const elapsed = performance.now() - start;
      const pct = Math.min(1, elapsed / duration);
      setWheelState(prev => {
        const w = { ...prev[wheel] };
        if (kind === 'unscrew') {
          const target = Math.floor(pct * 5);
          w.boltsUnscrewed = Math.min(5, Math.max(w.boltsUnscrewed, target));
        } else {
          const target = Math.floor(pct * 5);
          w.boltsSecured = Math.min(5, Math.max(w.boltsSecured, target));
        }
        return { ...prev, [wheel]: w };
      });
      if (pct < 1 && active) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  // removed legacy click-based tire handlers

  const cleanupStorage = () => {
    if (!jackTaken || !storageOpen) return;
    if (!jackLowered) return;
    if (looseOldTires > 0) setLooseOldTires(0);
    setJackTaken(false);
    setJackPos({ x: -120, y: 40 });
  };

  const dragDriverBack = (e: React.MouseEvent) => {
    if (!doorOpen || !driverOut) return;
    const startX = e.clientX, startY = e.clientY;
    const start = { ...driverPos };
    const onMove = (ev: MouseEvent) => {
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;
      setDriverPos({ 
          x: start.x + deltaX, 
          y: start.y + deltaY 
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (driverPos.x < -20) setDriverIn(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const closeDoorDrag = () => {
    if (!driverIn) return;
    setLeftDoorAngle(0);
    setRightDoorAngle(0);
    setDoorClosed(true);
  };

  // Helper to render bolts on SVG
  const RenderBolts = ({ wheel, x, y }: { wheel: WheelKey, x: number, y: number }) => {
    const st = wheelState[wheel];
    // 5 bolts pattern (radial)
    const offsets = [];
    const radius = 8;
    for (let i = 0; i < 5; i++) {
        // Start from top (angle -90 deg) or similar.
        // 5 points: 0, 72, 144, 216, 288.
        const angle = (i * 72 - 90) * (Math.PI / 180);
        offsets.push({ dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) });
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!st.removed && st.boltsUnscrewed < 5) {
            holdAction(wheel, 'unscrew');
        } else if (st.installed && st.boltsSecured < 5) {
            holdAction(wheel, 'secure');
        }
    };

    const handleWheelDrag = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (st.boltsUnscrewed === 5) {
            const startX = e.clientX;
            const startY = e.clientY;
            const startPos = wheelLoosePos[wheel] || { x, y };
            const wasRemoved = st.removed;
            const onMove = (ev: MouseEvent) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                setWheelLoosePos(prev => ({ ...prev, [wheel]: { x: startPos.x + dx, y: startPos.y + dy } }));
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                setWheelState(prev => {
                    const w = { ...prev[wheel] };
                    if (!wasRemoved) {
                        const moved = Math.hypot((wheelLoosePos[wheel]?.x ?? x) - x, (wheelLoosePos[wheel]?.y ?? y) - y);
                        if (moved > 20) {
                            w.removed = true;
                        }
                    }
                    return { ...prev, [wheel]: w };
                });
                if (!wasRemoved) {
                    const moved = Math.hypot((wheelLoosePos[wheel]?.x ?? x) - x, (wheelLoosePos[wheel]?.y ?? y) - y);
                    if (moved > 20) {
                        setLooseOldTires(v => v + 1);
                    }
                }
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        }
    };

    return (
        <g transform={`translate(${(wheelLoosePos[wheel]?.x ?? x)},${(wheelLoosePos[wheel]?.y ?? y)})`}>
            {/* Wheel Rect - Top View */}
            <rect 
                x="-18" y="-12" width="36" height="24" rx="2" 
                fill={st.removed && !st.installed ? '#222' : '#111'} 
                stroke={st.installed ? '#0f0' : (!st.removed ? '#f59e0b' : '#444')}
                strokeWidth={st.installed ? 1 : 0.5}
                className="cursor-pointer"
                onMouseDown={handleWheelDrag}
            />
            
            {/* Bolts */}
            {!st.removed && (
                <g className="cursor-pointer" onMouseDown={handleMouseDown}>
                     {offsets.map((off, i) => {
                         // Logic: 
                         // Unscrewing: boltsUnscrewed goes 0 -> 5.
                         // 0 unscrewed = all visible. 5 unscrewed = none visible.
                         // Securing: boltsSecured goes 0 -> 5.
                         // If installed, show based on secured count.
                         
                         let visible = true;
                         let color = '#ccc';
                         
                         if (!st.installed) {
                             // Unscrewing phase
                             if (i < st.boltsUnscrewed) visible = false;
                             // Visual feedback: color turns red/green? User said "circular indicators".
                             // Let's keep them simple silver/grey.
                         } else {
                             // Securing phase
                             if (i >= st.boltsSecured) visible = false; // Show one by one
                             color = '#0f0';
                         }
                         
                         if (!visible && st.installed) {
                             // Ghost bolts for targeting?
                             return <circle key={i} cx={off.dx} cy={off.dy} r="2" fill="#333" stroke="#555" strokeWidth="0.5" />;
                         }
                         if (!visible) return null;

                         return (
                             <circle key={i} cx={off.dx} cy={off.dy} r="2.5" fill={color} stroke="#000" strokeWidth="0.5" />
                         );
                     })}
                </g>
            )}
        </g>
    );
  };

  return (
    <div className="animate-fade-in">
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
        <GenericLeaderboard gameType="PIT_STOP_GT" />
      ) : (
        <div className="w-full max-w-5xl mx-auto p-4">
          <div className="flex items-center justify-center gap-2 mb-8">
            <h1 className="text-3xl font-black italic text-f1-red">{t('minigame.gt_pit_stop.title')}</h1>
            <PolicyInfo titleKey="policies.minigame_title" contentKey="policies.minigame_content" />
          </div>

          <div className="flex justify-between items-center mb-6">
            <p className="text-gray-400">{t('minigame.gt_pit_stop.instructions')}</p>
            <div className="text-right">
              <div className="text-4xl font-mono font-bold text-f1-red">
                {startTime === 0 ? '0.000' : finished ? (finishTime / 1000).toFixed(3) : (displayTime / 1000).toFixed(3)} s
              </div>
            </div>
          </div>

          <div ref={gameAreaRef} className="relative h-[500px] bg-neutral-800 rounded-xl overflow-hidden border-2 border-white/10 select-none">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

            <motion.div 
              className="absolute"
              style={{ top: '10%', left: '10%' }}
              initial={{ x: 600 }}
              animate={{ x: (approaching || parked) ? 0 : 600 }}
              transition={{ type: 'spring', stiffness: 50, damping: 20 }}
            >
              {/* Car Container - Centered, Rotated 180 (Nose Left) */}
              <svg width="600" height="300" viewBox="-300 -150 600 300" style={{ transform: 'rotate(180deg)' }}>
                {/* Shadow */}
                <ellipse cx="0" cy="0" rx="230" ry="90" fill="black" opacity="0.5" />

                {/* Wheels (Under Car) */}
                <RenderBolts wheel="RL" x={-140} y={55} />
                <RenderBolts wheel="RR" x={-140} y={-55} />
                <RenderBolts wheel="FL" x={140} y={55} />
                <RenderBolts wheel="FR" x={140} y={-55} />

                {/* Car Body - Better Top View Shape (Nose Right) */}
                {/* Main Chassis */}
                <path 
                    d="M 240,0 Q 240,-40 180,-50 L -160,-55 Q -220,-50 -220,-20 L -220,20 Q -220,50 -160,55 L 180,50 Q 240,40 240,0 Z" 
                    fill="#C00" stroke="#900" strokeWidth="2"
                />
                
                {/* Cabin / Windshield */}
                <path 
                    d="M 100,0 Q 100,-35 40,-40 L -60,-40 Q -100,-35 -100,0 Q -100,35 -60,40 L 40,40 Q 100,35 100,0 Z" 
                    fill="#111" stroke="#333"
                />

                {/* Rear Wing */}
                <rect x="-230" y="-60" width="20" height="120" rx="2" fill="#111" />
                <rect x="-210" y="-30" width="30" height="5" fill="#333" />
                <rect x="-210" y="25" width="30" height="5" fill="#333" />

                {/* Rear Storage Hatch (Draggable) */}
                <g transform="translate(-150, 0)">
                    {/* Base hole */}
                    <rect x="-30" y="-30" width="60" height="60" rx="4" fill="#000" stroke="#333" />
                    {/* Sliding Hatch */}
                    <g transform={`translate(-${storageDoorOffset}, 0)`}>
                        <rect x="-30" y="-30" width="60" height="60" rx="4" fill="#222" stroke="#444" 
                              className="cursor-ns-resize"
                              onMouseDown={handleStorageDoorDrag}
                        />
                        <line x1="0" y1="-20" x2="0" y2="20" stroke="#555" strokeWidth="2" />
                        <text x="-15" y="5" fill="#666" fontSize="8" textAnchor="middle" style={{ writingMode: 'vertical-rl' }}>PULL</text>
                    </g>
                    {/* Label */}
                    <text x="40" y="5" fill="#555" fontSize="8" textAnchor="middle" style={{ writingMode: 'vertical-rl' }}>STORAGE</text>
                    
                    {/* Jack in Storage - Directly draggable from SVG */}
                    {!jackTaken && storageOpen && (
                        <g transform="translate(0, -20)" onMouseDown={dragJack} className="cursor-grab active:cursor-grabbing">
                            <rect x="-10" y="-10" width="20" height="20" rx="2" fill="#FFD700" stroke="#B8860B" strokeWidth="1" />
                            <text x="0" y="2" fill="#000" fontSize="6" textAnchor="middle">JACK</text>
                        </g>
                    )}
                    
                    {/* Tires in Storage - Visual representation */}
                    {storageOpen && (
                        <g transform="translate(0, 10)">
                            {[...Array(newTiresInStorage)].map((_, i) => (
                                <g key={i} transform={`translate(0, ${i * 8})`} 
                                     onMouseDown={(e) => dragTireFromStorage(e, i)} 
                                     className="cursor-grab active:cursor-grabbing">
                                    <rect x="-8" y="-2" width="16" height="4" rx="1" fill="#111" stroke="#0F0" strokeWidth="0.5" />
                                </g>
                            ))}
                        </g>
                    )}
                </g>
                
                {newTireDrag && (
                  <g transform={`translate(${newTireDrag.x},${newTireDrag.y})`}>
                    <rect x="-8" y="-2" width="16" height="4" rx="1" fill="#111" stroke="#0F0" strokeWidth="0.5" />
                  </g>
                )}
                
                {/* Jack in World - When taken from storage */}
                {jackTaken && (
                    <g transform={`translate(${jackPos.x},${jackPos.y})`}>
                        <rect x="-15" y="-8" width="30" height="16" rx="3" fill="#FFD700" stroke="#B8860B" strokeWidth="1" onMouseDown={dragJack} className="cursor-grab active:cursor-grabbing" />
                        <circle cx="-8" cy="0" r="3" fill={jackRaised ? '#0F0' : '#F00'} />
                        <text x="5" y="2" fill="#000" fontSize="6" textAnchor="middle">JACK</text>
                        <rect x="8" y="-4" width="8" height="8" rx="1" fill="#333" stroke="#666" strokeWidth="0.5" 
                              className="cursor-pointer" onClick={toggleJackLever} />
                        <text x="12" y="1" fill="#FFF" fontSize="4" textAnchor="middle">L</text>
                    </g>
                )}

                {/* Left Door (Top in view - y negative) */}
                <g transform="translate(40, -40)">
                   {/* Pivot at 0,0 (Right side of this group, Front of door) */}
                   <g transform={`rotate(${-leftDoorAngle}, 0, 0)`}>
                      <path d="M -80,0 L 0,0 Q 10,0 10,5 L -80,5 Z" fill={doorOpen ? '#111' : '#A00'} stroke="#500" />
                      <rect x="-90" y="-10" width="100" height="20" fill="transparent" 
                            className="cursor-grab active:cursor-grabbing"
                            onMouseDown={(e) => handleDoorDrag(e, 'left')} 
                      />
                   </g>
                </g>

                {/* Right Door (Bottom in view - y positive) */}
                <g transform="translate(40, 40)">
                   <g transform={`rotate(${rightDoorAngle}, 0, 0)`}>
                      <path d="M -80,0 L 0,0 Q 10,0 10,-5 L -80,-5 Z" fill={doorOpen ? '#111' : '#A00'} stroke="#500" />
                      <rect x="-90" y="-10" width="100" height="20" fill="transparent" 
                            className="cursor-grab active:cursor-grabbing"
                            onMouseDown={(e) => handleDoorDrag(e, 'right')} 
                      />
                   </g>
                </g>

                {/* Driver */}
                <g transform={`translate(${driverPos.x},${driverPos.y})`}>
                  <circle r="12" fill="#E11D48" stroke="#FFF" strokeWidth="2" className="cursor-grab active:cursor-grabbing" onMouseDown={driverOut ? dragDriverBack : dragDriver} />
                  {/* Helmet Visor */}
                  <path d="M 5,-5 L 10,0 L 5,5" fill="none" stroke="#000" strokeWidth="3" />
                </g>
              </svg>
            </motion.div>

            {/* Storage and Jack are now integrated directly into the SVG */}

            {/* Car overlay controls */}
            <div className="absolute right-8 bottom-8 flex items-center gap-3">
              <button onClick={cleanupStorage} className="px-3 py-1 bg-white/10 rounded border border-white/10 hover:bg-white/20 text-xs">
                Put jack & tyres back
              </button>
              <button onClick={closeDoorDrag} className="px-3 py-1 bg-white/10 rounded border border-white/10 hover:bg-white/20 text-xs">
                Close doors
              </button>
            </div>

            <AnimatePresence>
              {(!parked || finished) && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10"
                >
                  {!finished ? (
                    <div className="text-center p-8 bg-neutral-900 rounded-2xl border border-white/10 max-w-md">
                      <Wrench className="w-12 h-12 text-f1-red mx-auto mb-4" />
                      <h2 className="text-2xl font-bold mb-2">{t('minigame.gt_pit_stop.ready_title')}</h2>
                      <p className="text-gray-400 mb-6">
                        {t('minigame.gt_pit_stop.objective')}
                      </p>
                      {error && (
                        <div className="mb-4 p-3 bg-red-500/20 text-red-200 rounded-lg flex items-center gap-2 text-sm">
                          <AlertCircle className="w-4 h-4" />
                          {error}
                        </div>
                      )}
                      <button 
                        onClick={startSequence}
                        className="px-8 py-3 bg-f1-red text-white font-bold rounded-full hover:bg-red-700 transition-colors flex items-center gap-2 mx-auto"
                      >
                        <Play className="w-5 h-5" />
                        {t('minigame.pit_stop.start_engine')}
                      </button>
                    </div>
                  ) : (
                    <div className="text-center p-8 bg-neutral-900 rounded-2xl border border-white/10 max-w-md">
                      <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                      <h2 className="text-2xl font-bold mb-2">{(finishTime / 1000).toFixed(3)}s</h2>
                      <p className="text-gray-400 mb-6">{t('minigame.pit_stop.result_time')}</p>
                      <div className="flex gap-3">
                        <button onClick={resetGame} className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-colors">
                          {t('minigame.pit_stop.menu')}
                        </button>
                        <button onClick={startSequence} className="flex-1 px-4 py-3 bg-f1-red hover:bg-red-700 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
                          <RotateCcw className="w-4 h-4" />
                          {t('minigame.try_again')}
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-6 text-center">
            <button 
              onClick={completeAndSubmit}
              disabled={!manualStartReady || submitting}
              className={`px-6 py-3 rounded-full font-bold ${manualStartReady ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-white/10 text-gray-400'} transition-colors`}
            >
              {submitting ? t('minigame.verifying') : 'Manual Start'}
            </button>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-center text-sm text-gray-500">
            <div className="p-4 bg-neutral-800 rounded-xl border border-white/5">
              <strong className="block text-white mb-1">1. {t('minigame.gt_pit_stop.step1_title')}</strong>
              {t('minigame.gt_pit_stop.step1_desc')}
            </div>
            <div className="p-4 bg-neutral-800 rounded-xl border border-white/5">
              <strong className="block text-white mb-1">2. {t('minigame.gt_pit_stop.step2_title')}</strong>
              {t('minigame.gt_pit_stop.step2_desc')}
            </div>
            <div className="p-4 bg-neutral-800 rounded-xl border border-white/5">
              <strong className="block text-white mb-1">3. {t('minigame.gt_pit_stop.step3_title')}</strong>
              {t('minigame.gt_pit_stop.step3_desc')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
