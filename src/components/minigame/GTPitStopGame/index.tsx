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
  boltsUnscrewed: number;
  removed: boolean;
  installed: boolean;
  boltsSecured: number;
}

export default function GTPitStopGame() {
  const { t } = useTranslation();
  const { playGTPitStopGame, wallet } = useEconomy();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<'GAME' | 'LEADERBOARD'>('GAME');

  const [startTime, setStartTime] = useState(0);
  const [finishTime, setFinishTime] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastReward, setLastReward] = useState<number | null>(null);

  const [approaching, setApproaching] = useState(false);
  const [parked, setParked] = useState(false);
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
  const [newTiresInStorage, setNewTiresInStorage] = useState(4);
  const [looseOldTires, setLooseOldTires] = useState(0);

  const [doorOffset, setDoorOffset] = useState(0);
  const [driverPos, setDriverPos] = useState({ x: -40, y: -10 });
  const [jackPos, setJackPos] = useState({ x: 120, y: 40 });
  const [storageDoorOffset, setStorageDoorOffset] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);

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
    setDoorOffset(0);
    setDriverPos({ x: -40, y: -10 });
    setJackPos({ x: 120, y: 40 });
    setStorageDoorOffset(0);
    setStartTime(0);
    setFinishTime(0);
    setDisplayTime(0);
    setError(null);
    setSubmitting(false);
    setLastReward(null);
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

  const allWheelsChanged = () =>
    ['FL', 'FR', 'RL', 'RR'].every(k => wheelState[k as WheelKey].installed && wheelState[k as WheelKey].boltsSecured === 5);

  useEffect(() => {
    if (allWheelsChanged() && jackLowered && jackTaken && storageOpen && driverIn && doorClosed) {
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
      setLastReward(result.reward || 0);
    } catch (e: any) {
      setError(e.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDoorDrag = (e: React.MouseEvent) => {
    if (!parked) return;
    setDragging('door');
    const startX = e.clientX;
    const startOffset = doorOffset;
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setDoorOffset(Math.max(0, Math.min(80, startOffset + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(null);
      if (doorOffset > 50) setDoorOpen(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleStorageDoorDrag = (e: React.MouseEvent) => {
    if (!parked) return;
    setDragging('storage');
    const startY = e.clientY;
    const startOffset = storageDoorOffset;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setStorageDoorOffset(Math.max(0, Math.min(80, startOffset + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(null);
      if (storageDoorOffset > 50) setStorageOpen(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const dragDriver = (e: React.MouseEvent) => {
    if (!doorOpen) return;
    setDragging('driver');
    const startX = e.clientX, startY = e.clientY;
    const start = { ...driverPos };
    const onMove = (ev: MouseEvent) => {
      setDriverPos({ x: start.x + (ev.clientX - startX) / 2, y: start.y + (ev.clientY - startY) / 2 });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(null);
      if (driverPos.x > 40) setDriverOut(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const dragJack = (e: React.MouseEvent) => {
    if (!storageOpen) return;
    setDragging('jack');
    const startX = e.clientX, startY = e.clientY;
    const start = { ...jackPos };
    const onMove = (ev: MouseEvent) => {
      setJackPos({ x: start.x + (ev.clientX - startX) / 2, y: start.y + (ev.clientY - startY) / 2 });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(null);
      if (jackPos.x < -10 && Math.abs(jackPos.y) < 20) setJackTaken(true);
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
    const start = performance.now();
    const duration = 1000;
    const tick = () => {
      const elapsed = performance.now() - start;
      const pct = Math.min(1, elapsed / duration);
      setWheelState(prev => {
        const w = { ...prev[wheel] };
        if (kind === 'unscrew') {
          w.boltsUnscrewed = Math.floor(pct * 5);
          if (pct >= 1) w.boltsUnscrewed = 5;
        } else {
          w.boltsSecured = Math.floor(pct * 5);
          if (pct >= 1) w.boltsSecured = 5;
        }
        return { ...prev, [wheel]: w };
      });
      if (pct < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const dragOldTireAway = (wheel: WheelKey) => {
    if (wheelState[wheel].boltsUnscrewed < 5) return;
    setWheelState(prev => ({ ...prev, [wheel]: { ...prev[wheel], removed: true } }));
    setLooseOldTires(v => v + 1);
  };

  const dragNewTireFromStorage = (wheel: WheelKey) => {
    if (!storageOpen || newTiresInStorage <= 0) return;
    if (!wheelState[wheel].removed) return;
    setWheelState(prev => ({ ...prev, [wheel]: { ...prev[wheel], installed: true } }));
    setNewTiresInStorage(v => v - 1);
  };

  const cleanupStorage = () => {
    if (!jackTaken || !storageOpen) return;
    if (!jackLowered) return;
    if (looseOldTires > 0) setLooseOldTires(0);
    setJackTaken(false);
    setJackPos({ x: 120, y: 40 });
  };

  const dragDriverBack = (e: React.MouseEvent) => {
    if (!doorOpen || !driverOut) return;
    setDragging('driverIn');
    const startX = e.clientX, startY = e.clientY;
    const start = { ...driverPos };
    const onMove = (ev: MouseEvent) => {
      setDriverPos({ x: start.x + (ev.clientX - startX) / 2, y: start.y + (ev.clientY - startY) / 2 });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragging(null);
      if (driverPos.x < -20) setDriverIn(true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const closeDoorDrag = () => {
    if (!driverIn) return;
    setDoorOffset(0);
    setDoorClosed(true);
  };

  const WheelUI = ({ wheel }: { wheel: WheelKey }) => {
    const st = wheelState[wheel];
    return (
      <div className="p-3 bg-neutral-800 rounded-xl border border-white/10">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs text-gray-400">{wheel}</span>
          <span className="text-xs text-gray-500">
            {st.boltsUnscrewed}/5 • {st.boltsSecured}/5
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <button onMouseDown={() => holdAction(wheel, 'unscrew')} className="px-2 py-1 bg-white/10 rounded hover:bg-white/20">
            Unscrew
          </button>
          <button onClick={() => dragOldTireAway(wheel)} className="px-2 py-1 bg-white/10 rounded hover:bg-white/20" disabled={st.boltsUnscrewed < 5}>
            Remove
          </button>
          <button onClick={() => dragNewTireFromStorage(wheel)} className="px-2 py-1 bg-white/10 rounded hover:bg-white/20" disabled={!st.removed || newTiresInStorage <= 0}>
            Install New
          </button>
          <button onMouseDown={() => holdAction(wheel, 'secure')} className="px-2 py-1 bg-white/10 rounded hover:bg-white/20" disabled={!st.installed}>
            Secure
          </button>
        </div>
        <div className="mt-2 h-1 bg-white/10 rounded">
          <div className="h-1 bg-f1-red rounded" style={{ width: `${(st.boltsUnscrewed / 5) * 100}%` }} />
        </div>
        <div className="mt-1 h-1 bg-white/10 rounded">
          <div className="h-1 bg-green-500 rounded" style={{ width: `${(st.boltsSecured / 5) * 100}%` }} />
        </div>
      </div>
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

          <div ref={gameAreaRef} className="relative h-[480px] bg-neutral-800 rounded-xl overflow-hidden border-2 border-white/10 select-none">
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

            <motion.div 
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
              initial={{ x: 500 }}
              animate={{ x: approaching ? 200 : 0 }}
              transition={{ type: 'spring', stiffness: 50, damping: 20 }}
            >
              <svg width="560" height="280" viewBox="-280 -140 560 280">
                <rect x="-220" y="-60" width="440" height="120" rx="16" fill="#222" stroke="#555" />
                <g transform="translate(-100,0)">
                  <rect x={-60 + doorOffset} y="-40" width="120" height="80" rx="10" fill={doorOpen ? '#111' : '#333'} stroke="#777" className="cursor-ew-resize" onMouseDown={handleDoorDrag} />
                  <text x={doorOffset > 50 ? 50 : 0} y="0" fill="#999" fontSize="10" textAnchor="middle">{doorOpen ? 'OPEN' : 'DRAG→'}</text>
                </g>
                <g transform={`translate(${driverPos.x},${driverPos.y})`}>
                  <rect x="-10" y="-10" width="20" height="20" rx="4" fill="#E11D48" className="cursor-grab active:cursor-grabbing" onMouseDown={driverOut ? dragDriverBack : dragDriver} />
                </g>
                <g transform="translate(-150,-50)">
                  <circle cx="0" cy="0" r="22" fill="#111" stroke="#999" />
                </g>
                <g transform="translate(150,-50)">
                  <circle cx="0" cy="0" r="22" fill="#111" stroke="#999" />
                </g>
                <g transform="translate(-150,50)">
                  <circle cx="0" cy="0" r="22" fill="#111" stroke="#999" />
                </g>
                <g transform="translate(150,50)">
                  <circle cx="0" cy="0" r="22" fill="#111" stroke="#999" />
                </g>
                <rect x="-40" y="-15" width="80" height="30" fill="none" stroke="#0f0" strokeDasharray="6 4" opacity="0.6" />
              </svg>
            </motion.div>

            <g className="absolute right-10 top-1/2 -translate-y-1/2">
              <div className="relative w-40 h-32 bg-neutral-700 rounded-xl border border-white/10">
                <div className="absolute inset-x-0 top-0 h-8 bg-neutral-600 rounded-t-xl cursor-ns-resize" onMouseDown={handleStorageDoorDrag}>
                  <div className="h-full bg-neutral-500" style={{ transform: `translateY(-${storageDoorOffset}px)` }} />
                </div>
                <div className="absolute inset-0 p-2 grid grid-cols-2 gap-2 opacity-100">
                  <div className="w-14 h-14 rounded-full bg-neutral-900 border border-white/10 flex items-center justify-center text-xs">NEW</div>
                  <div className="w-14 h-14 rounded-full bg-neutral-900 border border-white/10 flex items-center justify-center text-xs">NEW</div>
                  <div className="w-14 h-14 rounded-full bg-neutral-900 border border-white/10 flex items-center justify-center text-xs">NEW</div>
                  <div className="w-14 h-14 rounded-full bg-neutral-900 border border-white/10 flex items-center justify-center text-xs">NEW</div>
                  <div className="absolute -bottom-4 left-1/2 -translate-x-1/2">
                    <div className="w-24 h-6 bg-neutral-600 rounded cursor-grab active:cursor-grabbing" onMouseDown={dragJack} />
                  </div>
                </div>
              </div>
            </g>

            <div className="absolute left-1/2 -translate-x-1/2 bottom-8 flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${jackRaised ? 'bg-green-500' : 'bg-red-500'}`} />
              <button onClick={toggleJackLever} className="px-3 py-1 bg-white/10 rounded border border-white/10 hover:bg-white/20 text-xs">
                {jackRaised ? 'Lower (Red)' : 'Raise (Green)'}
              </button>
            </div>

            <div className="absolute left-8 top-8 grid grid-cols-2 md:grid-cols-4 gap-3">
              <WheelUI wheel="FL" />
              <WheelUI wheel="FR" />
              <WheelUI wheel="RL" />
              <WheelUI wheel="RR" />
            </div>

            <div className="absolute right-8 bottom-8 flex items-center gap-3">
              <button onClick={cleanupStorage} className="px-3 py-1 bg-white/10 rounded border border-white/10 hover:bg-white/20 text-xs">
                Put jack & tyres back
              </button>
              <button onClick={closeDoorDrag} className="px-3 py-1 bg-white/10 rounded border border-white/10 hover:bg-white/20 text-xs">
                Close door
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
