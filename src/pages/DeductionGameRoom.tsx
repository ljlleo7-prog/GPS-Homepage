import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDeductionGame } from '@/context/DeductionGameContext';

export default function DeductionGameRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const { t } = useTranslation();
  const { room, players, currentPlayer, races, seasonState, loading, joinRoom, submitAction, submitVote } = useDeductionGame();

  useEffect(() => {
    if (roomId) joinRoom(roomId);
  }, [roomId]);

  if (loading) return <div className="p-8">{t('deduction_game.game.loading')}</div>;
  if (!room) return <div className="p-8">{t('deduction_game.game.room_not_found')}</div>;

  const alivePlayers = players.filter(p => p.is_alive);
  const latestRace = races[races.length - 1];

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">{t('deduction_game.title')}</h1>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800 p-4 rounded">
            <div className="text-sm text-gray-400">{t('deduction_game.game.status')}</div>
            <div className="text-xl">{room.status}</div>
          </div>
          <div className="bg-gray-800 p-4 rounded">
            <div className="text-sm text-gray-400">{t('deduction_game.game.round')}</div>
            <div className="text-xl">{room.current_round} / {room.settings.total_races}</div>
          </div>
          <div className="bg-gray-800 p-4 rounded">
            <div className="text-sm text-gray-400">{t('deduction_game.game.board_pressure')}</div>
            <div className="text-xl">{seasonState?.board_pressure || 0} / {seasonState?.board_threshold || 0}</div>
          </div>
        </div>

        {currentPlayer && (
          <div className="bg-blue-900 p-4 rounded mb-8">
            <div className="text-sm text-gray-300">{t('deduction_game.game.your_role')}</div>
            <div className="text-2xl font-bold">{t(`deduction_game.roles.${currentPlayer.role}`)}</div>
            <div className="text-lg">{t(`deduction_game.alignment.${currentPlayer.alignment}`)}</div>
          </div>
        )}

        <div className="bg-gray-800 p-4 rounded mb-8">
          <h2 className="text-xl font-bold mb-4">{t('deduction_game.game.players')} ({alivePlayers.length})</h2>
          <div className="space-y-2">
            {players.map(p => (
              <div key={p.id} className={`p-2 rounded ${p.is_alive ? 'bg-gray-700' : 'bg-gray-900 opacity-50'}`}>
                <span className="font-bold">{p.display_name}</span>
                {p.is_tp && <span className="ml-2 text-yellow-400">[{t('deduction_game.roles.TP')}]</span>}
                {!p.is_alive && <span className="ml-2 text-red-400">[{t('deduction_game.game.fired')}]</span>}
              </div>
            ))}
          </div>
        </div>

        {latestRace && (
          <div className="bg-gray-800 p-4 rounded mb-8">
            <h2 className="text-xl font-bold mb-2">{t('deduction_game.game.latest_race')}</h2>
            <p>{latestRace.public_report}</p>
          </div>
        )}

        {room.status === 'night_phase' && currentPlayer?.is_alive && (
          <div className="bg-gray-800 p-4 rounded mb-8">
            <h2 className="text-xl font-bold mb-4">{t('deduction_game.actions.night_action')}</h2>
            {currentPlayer.role === 'TC' && (
              <div className="space-y-2">
                <button
                  onClick={() => submitAction(currentPlayer.alignment === 'positive' ? 'tc_protect' : 'tc_sabotage', '1')}
                  className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded"
                >
                  {t(`deduction_game.actions.${currentPlayer.alignment === 'positive' ? 'protect' : 'sabotage'}`)} {t('deduction_game.actions.driver')} 1
                </button>
                <button
                  onClick={() => submitAction(currentPlayer.alignment === 'positive' ? 'tc_protect' : 'tc_sabotage', '2')}
                  className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded"
                >
                  {t(`deduction_game.actions.${currentPlayer.alignment === 'positive' ? 'protect' : 'sabotage'}`)} {t('deduction_game.actions.driver')} 2
                </button>
              </div>
            )}
          </div>
        )}

        {room.status === 'voting' && currentPlayer?.is_alive && (
          <div className="bg-gray-800 p-4 rounded">
            <h2 className="text-xl font-bold mb-4">{t('deduction_game.actions.vote_to_fire')}</h2>
            <div className="space-y-2">
              {alivePlayers.filter(p => p.id !== currentPlayer.id).map(p => (
                <button
                  key={p.id}
                  onClick={() => submitVote(p.id)}
                  className="w-full bg-red-600 hover:bg-red-700 p-2 rounded text-left"
                >
                  {t('deduction_game.actions.fire')} {p.display_name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
