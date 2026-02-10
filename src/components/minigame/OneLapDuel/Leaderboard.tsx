import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { Trophy, Clock, Medal } from 'lucide-react';

export default function Leaderboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    // Ideally use a view that joins profiles
    // Since we don't have a view, we fetch and join manually or use a joined query if relations exist
    // We created relation to profiles in migration
    const { data } = await supabase
      .from('one_lap_leaderboard')
      .select('*, profiles(username, avatar_url)')
      .order('best_gap_sec', { ascending: true }) // More negative time gap (further ahead) is better
      .limit(50);
    
    if (data) setLeaderboard(data);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Trophy className="w-6 h-6 text-yellow-500" />
        {t('minigame_onelapduel.leaderboard.title')}
      </h2>

      <div className="bg-surface rounded-lg overflow-hidden border border-white/10">
        <table className="w-full text-left">
          <thead className="bg-black/50 text-gray-400 uppercase text-xs font-mono">
            <tr>
              <th className="px-6 py-4">{t('minigame_onelapduel.leaderboard.rank')}</th>
              <th className="px-6 py-4">{t('minigame_onelapduel.leaderboard.driver')}</th>
              <th className="px-6 py-4 text-right">{t('minigame_onelapduel.leaderboard.best_gap')}</th>
              <th className="px-6 py-4 text-right">{t('minigame_onelapduel.leaderboard.wins')}</th>
              <th className="px-6 py-4 text-right">{t('minigame_onelapduel.leaderboard.points')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {leaderboard.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  {t('minigame_onelapduel.leaderboard.no_records')}
                </td>
              </tr>
            ) : (
              leaderboard.map((entry, index) => (
                <tr key={entry.user_id} className={`hover:bg-white/5 transition-colors ${entry.user_id === user?.id ? 'bg-primary/10' : ''}`}>
                  <td className="px-6 py-4 font-mono">
                    {index === 0 && <span className="text-yellow-400 text-xl">🥇</span>}
                    {index === 1 && <span className="text-gray-300 text-xl">🥈</span>}
                    {index === 2 && <span className="text-orange-400 text-xl">🥉</span>}
                    {index > 2 && <span className="text-gray-500">#{index + 1}</span>}
                  </td>
                  <td className="px-6 py-4 font-bold flex items-center gap-3">
                    {entry.profiles?.avatar_url && <img src={entry.profiles.avatar_url} className="w-6 h-6 rounded-full" />}
                    {entry.profiles?.username || t('minigame_onelapduel.common.unknown')}
                    {entry.user_id === user?.id && <span className="text-xs bg-primary text-black px-2 py-0.5 rounded">{t('minigame_onelapduel.leaderboard.you')}</span>}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-f1-red font-bold">
                    {typeof entry.best_gap_sec === 'number'
                      ? `${entry.best_gap_sec > 0 ? '+' : ''}${entry.best_gap_sec.toFixed(3)}s`
                      : '--'}
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-green-400">
                    {entry.wins}
                  </td>
                  <td className="px-6 py-4 text-right font-mono">
                    {entry.total_points}
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
