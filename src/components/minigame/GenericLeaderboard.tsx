import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Trophy, Clock, Users } from 'lucide-react';
import { useEconomy } from '../../context/EconomyContext';
import { useAuth } from '../../context/AuthContext';

interface GenericLeaderboardProps {
    gameType: string;
    formatScore?: (score: number) => string;
}

export default function GenericLeaderboard({ gameType, formatScore }: GenericLeaderboardProps) {
    const { t } = useTranslation();
    const { user } = useAuth();
    const { getMonthlyLeaderboard, getMonthlyPool } = useEconomy();
    
    const [leaderboard, setLeaderboard] = useState<any[]>([]);
    const [poolData, setPoolData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, [gameType]);

    const loadData = async () => {
        setLoading(true);
        const [lb, pool] = await Promise.all([
            getMonthlyLeaderboard(gameType),
            getMonthlyPool(gameType)
        ]);
        
        if (lb.success) setLeaderboard(lb.data || []);
        if (pool.success) setPoolData(pool.data);
        setLoading(false);
    };

    const defaultFormatScore = (ms: number) => (ms / 1000).toFixed(3) + 's';

    return (
        <div className="animate-fade-in">
            {/* Pool Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-neutral-800 p-4 rounded-xl border border-white/5 flex items-center gap-4">
                    <div className="p-3 bg-f1-red/20 rounded-full">
                        <Trophy className="w-6 h-6 text-f1-red" />
                    </div>
                    <div>
                        <div className="text-sm text-gray-400">{t('minigame.pool.total')}</div>
                        <div className="text-2xl font-bold">{poolData?.dynamic_pool || 500} <span className="text-sm font-normal text-gray-500">TOKENS</span></div>
                    </div>
                </div>
                <div className="bg-neutral-800 p-4 rounded-xl border border-white/5 flex items-center gap-4">
                    <div className="p-3 bg-blue-500/20 rounded-full">
                        <Users className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                        <div className="text-sm text-gray-400">{t('minigame.pool.players')}</div>
                        <div className="text-2xl font-bold">{poolData?.total_plays || 0}</div>
                    </div>
                </div>
                <div className="bg-neutral-800 p-4 rounded-xl border border-white/5 flex items-center gap-4">
                    <div className="p-3 bg-green-500/20 rounded-full">
                        <Clock className="w-6 h-6 text-green-500" />
                    </div>
                    <div>
                        <div className="text-sm text-gray-400">{t('minigame.pool.ends_in')}</div>
                        <div className="text-xl font-bold">{new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate()}d</div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-neutral-800 rounded-xl overflow-hidden border border-white/5">
                <table className="w-full text-left">
                    <thead className="bg-black/50 text-gray-400 uppercase text-xs font-mono">
                        <tr>
                            <th className="px-6 py-4">{t('minigame.leaderboard.rank')}</th>
                            <th className="px-6 py-4">{t('minigame.leaderboard.player')}</th>
                            <th className="px-6 py-4 text-right">{t('minigame.leaderboard.score')}</th>
                            <th className="px-6 py-4 text-right">{t('minigame.leaderboard.attempts')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {loading ? (
                            <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
                        ) : leaderboard.length === 0 ? (
                            <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">{t('minigame.leaderboard.no_records')}</td></tr>
                        ) : (
                            leaderboard.map((entry, index) => (
                                <tr key={entry.user_id} className={`hover:bg-white/5 transition-colors ${entry.user_id === user?.id ? 'bg-f1-red/10' : ''}`}>
                                    <td className="px-6 py-4 font-mono">
                                        {index === 0 && <span className="text-yellow-400 text-xl">🥇</span>}
                                        {index === 1 && <span className="text-gray-300 text-xl">🥈</span>}
                                        {index === 2 && <span className="text-orange-400 text-xl">🥉</span>}
                                        {index > 2 && <span className="text-gray-500">#{index + 1}</span>}
                                    </td>
                                    <td className="px-6 py-4 font-bold flex items-center gap-3">
                                        {/* Avatar if available, otherwise initial */}
                                        {entry.avatar_url ? (
                                            <img 
                                                src={entry.avatar_url} 
                                                alt={entry.username} 
                                                className="w-8 h-8 rounded-full object-cover border border-white/10"
                                            />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-neutral-700 flex items-center justify-center text-xs">
                                                {entry.username?.[0]?.toUpperCase()}
                                            </div>
                                        )}
                                        <span className={entry.user_id === user?.id ? 'text-f1-red' : 'text-white'}>
                                            {entry.username}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-f1-red font-bold">
                                        {(formatScore || defaultFormatScore)(entry.best_score)}
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-gray-500">
                                        {entry.play_count}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
