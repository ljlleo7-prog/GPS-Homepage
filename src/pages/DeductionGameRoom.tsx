import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDeductionGame } from '@/context/DeductionGameContext';
import { Send, AlertTriangle, Flag } from 'lucide-react';

export default function DeductionGameRoom() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { room, players, currentPlayer, races, seasonState, messages, loading, joinRoom, submitAction, submitVote, sendMessage } = useDeductionGame();
  const [messageInput, setMessageInput] = useState('');
  const [selectedTarget, setSelectedTarget] = useState('');

  useEffect(() => {
    if (roomId) joinRoom(roomId);
  }, [roomId]);

  useEffect(() => {
    if (room?.shutdown_at) {
      navigate('/deduction-game');
    }
  }, [room?.shutdown_at, navigate]);

  if (loading) return <div className="p-8">{t('deduction_game.game.loading')}</div>;
  if (!room) return <div className="p-8">{t('deduction_game.game.room_not_found')}</div>;

  const alivePlayers = players.filter(p => p.is_alive);
  const latestRace = races[races.length - 1];
  const activePlayers = players.filter(p => !p.left_at);
  const maxPlayers = room.settings.max_players;

  if (room.status === 'lobby') {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">{t('deduction_game.title')}</h1>
          <div className="bg-gray-800 p-6 rounded-lg">
            <h2 className="text-xl font-bold mb-4">{t('deduction_game.lobby.waiting')}</h2>
            <div className="text-lg mb-4">{activePlayers.length} / {maxPlayers} {t('deduction_game.game.players')}</div>
            <div className="space-y-2">
              {activePlayers.map(p => (
                <div key={p.id} className="bg-gray-700 p-3 rounded flex items-center justify-between">
                  <span className="font-bold">{p.display_name}</span>
                  <span className={`text-xs ${p.is_online ? 'text-green-400' : 'text-gray-500'}`}>
                    {p.is_online ? 'Online' : 'Offline'}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-400 mt-4">
              {activePlayers.length < maxPlayers
                ? t('deduction_game.lobby.waiting_for_players')
                : t('deduction_game.lobby.starting_soon')}
            </p>
          </div>
        </div>
      </div>
    );
  }

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
            <div className="flex items-center gap-2 mb-2">
              <Flag className="w-4 h-4 text-green-400" />
              <h2 className="text-xl font-bold">{t('deduction_game.game.latest_race')}</h2>
            </div>
            <p className="text-sm">{latestRace.public_report}</p>
          </div>
        )}

        <div className="bg-gray-800 p-4 rounded mb-8 border border-purple-500/30">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-purple-400" />
            <h2 className="text-xl font-bold text-purple-400">{t('deduction_game.log.title')}</h2>
          </div>
          <div className="bg-gray-900 rounded p-3 h-64 overflow-y-auto space-y-1 mb-3 font-mono text-xs">
            {messages.map((msg, i) => {
              const author = players.find(p => p.id === msg.author_player_id);
              return (
                <div key={msg.id}>
                  <span className="text-blue-400">#{author?.seat_index ?? 0}</span>
                  <span className="text-gray-500"> {author?.display_name ?? 'Unknown'}: </span>
                  <span className="text-gray-300">{msg.content}</span>
                </div>
              );
            })}
          </div>
          {room.status === 'discussion' && currentPlayer?.is_alive && (
            <div className="flex gap-2">
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && messageInput.trim()) {
                    sendMessage(messageInput.trim());
                    setMessageInput('');
                  }
                }}
                placeholder={t('deduction_game.log.type_message')}
                className="flex-1 bg-gray-700 border border-white/10 p-2 rounded text-sm"
              />
              <button
                onClick={() => {
                  if (messageInput.trim()) {
                    sendMessage(messageInput.trim());
                    setMessageInput('');
                  }
                }}
                className="bg-purple-600 hover:bg-purple-700 p-2 rounded"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {room.status === 'night_phase' && currentPlayer?.is_alive && (
          <div className="bg-gray-800 p-4 rounded mb-8">
            <h2 className="text-xl font-bold mb-4">{t('deduction_game.actions.night_action')}</h2>

            {currentPlayer.role === 'TP' && (
              <div className="text-sm text-gray-400">
                {t('deduction_game.night.no_action')}
              </div>
            )}

            {currentPlayer.role === 'TC' && (
              <div className="space-y-2">
                <p className="text-sm text-gray-400 mb-3">
                  {currentPlayer.alignment === 'positive'
                    ? t('deduction_game.actions.tc_protect_desc')
                    : t('deduction_game.actions.tc_sabotage_desc')}
                </p>
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

            {currentPlayer.role === 'IS' && (
              <div className="space-y-2">
                <p className="text-sm text-gray-400 mb-3">
                  {currentPlayer.alignment === 'positive'
                    ? t('deduction_game.actions.is_check_desc')
                    : t('deduction_game.actions.is_leak_desc')}
                </p>
                {alivePlayers.filter(p => p.id !== currentPlayer.id).map(p => (
                  <button
                    key={p.id}
                    onClick={() => submitAction(currentPlayer.alignment === 'positive' ? 'is_check' : 'is_leak', p.id)}
                    className="w-full bg-purple-600 hover:bg-purple-700 p-2 rounded text-left"
                  >
                    {t(`deduction_game.actions.${currentPlayer.alignment === 'positive' ? 'inspect' : 'leak'}`)} #{p.seat_index} {p.display_name}
                  </button>
                ))}
              </div>
            )}

            {currentPlayer.role === 'ST' && (
              <div className="space-y-2">
                <p className="text-sm text-gray-400 mb-3">
                  {t('deduction_game.actions.st_analyze_desc')}
                </p>
                <button
                  onClick={() => submitAction('st_strategic_sabotage', '1')}
                  className="w-full bg-green-600 hover:bg-green-700 p-2 rounded"
                >
                  {t('deduction_game.actions.analyze')} {t('deduction_game.actions.driver')} 1
                </button>
                <button
                  onClick={() => submitAction('st_strategic_sabotage', '2')}
                  className="w-full bg-green-600 hover:bg-green-700 p-2 rounded"
                >
                  {t('deduction_game.actions.analyze')} {t('deduction_game.actions.driver')} 2
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
