
import { useState, useRef, useEffect } from 'react';
import { useEconomy } from '../context/EconomyContext';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { Trophy, Clock, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function Minigame() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { playReactionGame, getMonthlyLeaderboard, getMonthlyPool, wallet } = useEconomy();
  
  const [gameState, setGameState] = useState<'IDLE' | 'COUNTDOWN' | 'WAITING_FOR_GREEN' | 'GO' | 'FINISHED' | 'FALSE_START'>('IDLE');
  const [lightsOn, setLightsOn] = useState(0); // 0 to 5
  const [reactionTime, setReactionTime] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastReward, setLastReward] = useState<number | null>(null);
  
  // Leaderboard State
  const [activeTab, setActiveTab] = useState<'GAME' | 'LEADERBOARD'>('GAME');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [poolData, setPoolData] = useState<any>(null);

  const startTimeRef = useRef<number>(0);
  const timeoutRefs = useRef<NodeJS.Timeout[]>([]);
  const clickLockedRef = useRef(false);

  useEffect(() => {
    if (activeTab === 'LEADERBOARD') {
        loadLeaderboard();
    }
  }, [activeTab]);

  const loadLeaderboard = async () => {
    const [lb, pool] = await Promise.all([
        getMonthlyLeaderboard(),
        getMonthlyPool()
    ]);
    if (lb.success) setLeaderboard(lb.data || []);
    if (pool.success) setPoolData(pool.data);
  };


  const clearAllTimeouts = () => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
  };

  const startGame = () => {
    if (!user) {
        setMessage(t('minigame.login_warning'));
        return;
    }

    if (wallet && wallet.token_balance < 1) {
        setMessage(t('minigame.cost_warning') || "Insufficient tokens (1 required)");
        return;
    }

    setGameState('COUNTDOWN');
    setLightsOn(0);
    setReactionTime(null);
    setMessage('');
    setLastReward(null);
    clearAllTimeouts();
    clickLockedRef.current = false;

    // Sequence: Light 1..5 ON (1s interval) -> Random Delay -> All OFF
    let delay = 1000;
    
    // Light 1
    timeoutRefs.current.push(setTimeout(() => setLightsOn(1), delay));
    delay += 1000;
    // Light 2
    timeoutRefs.current.push(setTimeout(() => setLightsOn(2), delay));
    delay += 1000;
    // Light 3
    timeoutRefs.current.push(setTimeout(() => setLightsOn(3), delay));
    delay += 1000;
    // Light 4
    timeoutRefs.current.push(setTimeout(() => setLightsOn(4), delay));
    delay += 1000;
    // Light 5
    timeoutRefs.current.push(setTimeout(() => {
        setLightsOn(5);
        setGameState('WAITING_FOR_GREEN');
        
        // Random delay between 0.2s and 3s before lights out
        const randomDelay = 200 + Math.random() * 2800;
        timeoutRefs.current.push(setTimeout(() => {
            setLightsOn(0);
            setGameState('GO');
            startTimeRef.current = Date.now();
        }, randomDelay));
        
    }, delay));
  };

  const handleClick = async () => {
    if (clickLockedRef.current || gameState === 'IDLE' || gameState === 'FINISHED' || gameState === 'FALSE_START') return;
    clickLockedRef.current = true;

    if (gameState !== 'GO') {
        // False start!
        setGameState('FALSE_START');
        clearAllTimeouts();
        setLightsOn(0); // Optional: keep them on or turn off? Real F1 aborts.
        return;
    }

    // Good start
    const endTime = Date.now();
    const diff = endTime - startTimeRef.current;
    setReactionTime(diff);
    setGameState('FINISHED');

    // Submit score
    setSubmitting(true);
    const result = await playReactionGame(diff);
    setSubmitting(false);

    if (result.success) {
        setLastReward(result.reward || 0);
        setMessage(result.message || t('minigame.great_job'));
    } else {
        setMessage(result.message || t('minigame.save_failed'));
    }
  };

  // Cleanup
  useEffect(() => {
    return () => clearAllTimeouts();
  }, []);

  return (
    <div className="min-h-screen bg-neutral-900 text-white pt-24 px-4">
      <div className="max-w-4xl mx-auto">
        
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

        {activeTab === 'GAME' ? (
          <div className="text-center">
            <h1 className="text-4xl font-bold mb-8 text-f1-red">{t('minigame.title')}</h1>
            <p className="text-gray-400 mb-12">
              {t('minigame.instructions')}
            </p>

            {/* Lights Container */}
            <div className="flex justify-center gap-2 md:gap-4 mb-16 bg-black p-8 rounded-lg border border-neutral-800">
                {[1, 2, 3, 4, 5].map((i) => (
                    <div 
                        key={i}
                        className={`w-16 h-16 md:w-24 md:h-24 rounded-full border-4 border-neutral-800 transition-colors duration-100
                            ${lightsOn >= i ? 'bg-red-600 shadow-[0_0_30px_rgba(220,38,38,0.6)]' : 'bg-neutral-900'}
                        `}
                    />
                ))}
            </div>

            {/* Interaction Area / Message */}
            <div className="min-h-[200px] flex flex-col items-center justify-center">
                
                {!user && (
                    <div className="mb-8 p-4 bg-yellow-900/30 border border-yellow-700 text-yellow-500 rounded">
                        {t('minigame.login_to_save')}
                    </div>
                )}

                {gameState === 'IDLE' && (
                    <button 
                        onClick={startGame}
                        className="bg-f1-red hover:bg-red-700 text-white font-bold py-4 px-12 rounded-full text-xl transition-all"
                    >
                        {t('minigame.start_game')}
                    </button>
                )}

                {(gameState === 'COUNTDOWN' || gameState === 'WAITING_FOR_GREEN') && (
                    <>
                        <div className="w-full h-64 flex items-center justify-center select-none pointer-events-none">
                            <p className="text-2xl text-gray-400 animate-pulse">{t('minigame.wait_for_it')}</p>
                        </div>
                        {/* Full Screen Hitbox to prevent spamming from safe zones */}
                        <div 
                            className="fixed inset-0 z-50 cursor-crosshair"
                            onMouseDown={handleClick}
                        />
                    </>
                )}

                {gameState === 'GO' && (
                    <div 
                        className="fixed inset-0 z-50 flex items-center justify-center bg-transparent cursor-pointer"
                        onMouseDown={handleClick}
                    >
                        {/* Invisible overlay to catch clicks anywhere quickly */}
                        <div className="bg-green-500/10 w-full h-full flex items-center justify-center">
                            <p className="text-6xl font-black text-green-500">{t('minigame.click')}</p>
                        </div>
                    </div>
                )}

                {gameState === 'FALSE_START' && (
                    <div className="text-center">
                        <h2 className="text-4xl font-bold text-yellow-500 mb-4">{t('minigame.jump_start')}</h2>
                        <p className="text-gray-400 mb-8">{t('minigame.jump_start_message')}</p>
                        <button 
                            onClick={startGame}
                            className="bg-neutral-700 hover:bg-neutral-600 text-white font-bold py-3 px-8 rounded-full"
                        >
                            {t('minigame.try_again')}
                        </button>
                    </div>
                )}

                {gameState === 'FINISHED' && (
                    <div className="text-center animate-fade-in-up">
                        <h2 className="text-6xl font-black text-white mb-2">
                            {reactionTime} <span className="text-2xl text-gray-500">ms</span>
                        </h2>
                        
                        {submitting ? (
                            <p className="text-gray-400">{t('minigame.verifying')}</p>
                        ) : (
                            <div className="mt-4 space-y-4">
                                <p className={`text-xl ${message.includes('Cooldown') ? 'text-yellow-500' : 'text-green-400'}`}>
                                    {message}
                                </p>
                                {lastReward !== null && lastReward > 0 && (
                                    <div className="p-4 bg-f1-red/20 border border-f1-red/50 rounded-lg inline-block">
                                        <span className="text-f1-red font-bold">+{lastReward} {t('minigame.tokens_earned')}</span>
                                    </div>
                                )}
                                <div className="mt-8">
                                    <button 
                                        onClick={startGame}
                                        className="bg-white text-black hover:bg-gray-200 font-bold py-3 px-8 rounded-full transition-colors"
                                    >
                                        {t('minigame.play_again')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
          </div>
        ) : (
            // Leaderboard UI
            <div className="animate-fade-in-up">
                <div className="text-center mb-12">
                    <h2 className="text-3xl font-bold mb-4">{t('minigame.monthly_championship')}</h2>
                    <p className="text-gray-400 max-w-2xl mx-auto">
                        {t('minigame.championship_description')}
                    </p>
                </div>

                {/* Pool Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
                    <div className="bg-surface p-6 rounded-lg border border-white/10 text-center">
                        <Users className="w-8 h-8 text-primary mx-auto mb-2" />
                        <div className="text-2xl font-bold">{poolData?.total_plays || 0}</div>
                        <div className="text-sm text-gray-400">{t('minigame.total_plays')}</div>
                    </div>
                    <div className="bg-surface p-6 rounded-lg border border-f1-red/50 text-center relative overflow-hidden">
                        <div className="absolute inset-0 bg-f1-red/10 animate-pulse"></div>
                        <Trophy className="w-8 h-8 text-f1-red mx-auto mb-2 relative z-10" />
                        <div className="text-3xl font-black text-f1-red relative z-10">{poolData?.dynamic_pool || 0}</div>
                        <div className="text-sm text-gray-300 relative z-10">{t('minigame.prize_pool')}</div>
                    </div>
                    <div className="bg-surface p-6 rounded-lg border border-white/10 text-center">
                        <Clock className="w-8 h-8 text-secondary mx-auto mb-2" />
                        <div className="text-2xl font-bold">{leaderboard.length > 0 ? leaderboard[0].best_score + 'ms' : '--'}</div>
                        <div className="text-sm text-gray-400">{t('minigame.current_record')}</div>
                    </div>
                </div>

                {/* Table */}
                <div className="bg-surface rounded-lg overflow-hidden border border-white/10">
                    <table className="w-full text-left">
                        <thead className="bg-black/50 text-gray-400 uppercase text-xs font-mono">
                            <tr>
                                <th className="px-6 py-4">{t('minigame.rank')}</th>
                                <th className="px-6 py-4">{t('minigame.pilot')}</th>
                                <th className="px-6 py-4 text-right">{t('minigame.reaction_time')}</th>
                                <th className="px-6 py-4 text-right">{t('minigame.est_prize')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {leaderboard.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                                        {t('minigame.no_times_recorded')}
                                    </td>
                                </tr>
                            ) : (
                                leaderboard.map((entry) => {
                                    let prize = 0;
                                    const pool = poolData?.dynamic_pool || 0;
                                    if (entry.rank === 1) prize = Math.floor(pool * 0.3);
                                    else if (entry.rank === 2) prize = Math.floor(pool * 0.2);
                                    else if (entry.rank === 3) prize = Math.floor(pool * 0.1);
                                    else if (entry.rank <= 10) prize = Math.floor((pool * 0.4) / 7);

                                    return (
                                        <tr key={entry.user_id} className={`hover:bg-white/5 transition-colors ${entry.user_id === user?.id ? 'bg-primary/10' : ''}`}>
                                            <td className="px-6 py-4 font-mono">
                                                {entry.rank === 1 && <span className="text-yellow-400 text-xl">🥇</span>}
                                                {entry.rank === 2 && <span className="text-gray-300 text-xl">🥈</span>}
                                                {entry.rank === 3 && <span className="text-orange-400 text-xl">🥉</span>}
                                                {entry.rank > 3 && <span className="text-gray-500">#{entry.rank}</span>}
                                            </td>
                                            <td className="px-6 py-4 font-bold">
                                                {entry.username}
                                                {entry.user_id === user?.id && <span className="ml-2 text-xs bg-primary text-black px-2 py-0.5 rounded">{t('minigame.you')}</span>}
                                            </td>
                                            <td className="px-6 py-4 text-right font-mono text-f1-red font-bold">
                                                {entry.best_score}ms
                                            </td>
                                            <td className="px-6 py-4 text-right font-mono text-green-400">
                                                {prize > 0 ? `+${prize}` : '-'}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}
