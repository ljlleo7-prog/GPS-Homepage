import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

export default function DeductionGameLobby() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [totalRaces, setTotalRaces] = useState(12);

  const createRoom = async () => {
    if (!user) return;
    setCreating(true);

    try {
      const { data, error } = await supabase.functions.invoke('deduction-create-room', {
        body: {
          settings: {
            max_players: maxPlayers,
            total_races: totalRaces,
            language: 'en',
            allow_bots: true,
          },
        },
      });

      if (error) throw error;

      const roomId = data.room.id;

      await supabase.functions.invoke('deduction-join-room', {
        body: {
          room_id: roomId,
          display_name: user.email?.split('@')[0] || 'Player',
          fill_bots: true,
        },
      });

      await supabase.functions.invoke('deduction-start-game', {
        body: { room_id: roomId },
      });

      navigate(`/deduction-game/${roomId}`);
    } catch (error) {
      console.error('Error creating room:', error);
    } finally {
      setCreating(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl font-bold mb-4">{t('deduction_game.title')}</h1>
          <p>{t('deduction_game.lobby.login_required')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">{t('deduction_game.title')}</h1>

        <div className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-xl font-bold mb-4">Quick Local Alpha</h2>
          <p className="text-sm text-gray-300 mb-4">
            Play instantly with bots in your browser. This avoids Supabase edge functions and is best for cold-start testing.
          </p>
          <button
            onClick={() => navigate('/deduction-game/local')}
            className="w-full bg-green-600 hover:bg-green-700 p-3 rounded font-bold"
          >
            Play Local Bot Game
          </button>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg mt-8">
          <h2 className="text-xl font-bold mb-4">{t('deduction_game.lobby.create_game')}</h2>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm mb-2">{t('deduction_game.lobby.players')}</label>
              <select
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                className="w-full bg-gray-700 p-2 rounded"
              >
                {[4, 5, 6, 7, 8].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2">{t('deduction_game.lobby.total_races')}</label>
              <select
                value={totalRaces}
                onChange={(e) => setTotalRaces(Number(e.target.value))}
                className="w-full bg-gray-700 p-2 rounded"
              >
                {[7, 10, 12, 15, 20].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={createRoom}
            disabled={creating}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 p-3 rounded font-bold"
          >
            {creating ? t('deduction_game.lobby.creating') : t('deduction_game.lobby.create_start')}
          </button>
        </div>

        <div className="mt-8 bg-gray-800 p-6 rounded-lg">
          <h3 className="text-lg font-bold mb-2">{t('deduction_game.lobby.how_to_play')}</h3>
          <ul className="space-y-2 text-sm text-gray-300">
            <li>• {t('deduction_game.rules.rule_1')}</li>
            <li>• {t('deduction_game.rules.rule_2')}</li>
            <li>• {t('deduction_game.rules.rule_3')}</li>
            <li>• {t('deduction_game.rules.rule_4')}</li>
            <li>• {t('deduction_game.rules.rule_5')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
