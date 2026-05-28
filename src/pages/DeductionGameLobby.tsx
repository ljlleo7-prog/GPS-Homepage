import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Plus, User, RefreshCw, Users } from 'lucide-react';

export default function DeductionGameLobby() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [totalRaces, setTotalRaces] = useState(12);

  useEffect(() => {
    if (!user) return;
    fetchRooms();

    const channel = supabase
      .channel('public:deduction_rooms_lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deduction_rooms' }, () => {
        fetchRooms();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deduction_room_players' }, () => {
        fetchRooms();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fetchRooms = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('deduction_rooms')
      .select(`
        *,
        deduction_room_players (
          user_id,
          is_online,
          left_at
        ),
        profiles:host_user_id (username, avatar_url)
      `)
      .in('status', ['lobby', 'night_phase', 'discussion', 'voting'])
      .is('shutdown_at', null)
      .order('created_at', { ascending: false });

    if (data) setRooms(data);
    setLoading(false);
  };

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
            allow_bots: false,
          },
        },
      });

      if (error) throw error;

      const roomId = data.room.id;

      await supabase.functions.invoke('deduction-join-room', {
        body: {
          room_id: roomId,
          display_name: user.email?.split('@')[0] || 'Player',
        },
      });

      navigate(`/deduction-game/${roomId}`);
    } catch (error) {
      console.error('Error creating room:', error);
    } finally {
      setCreating(false);
    }
  };

  const joinRoom = async (roomId: string) => {
    if (!user) return;

    const { error } = await supabase.functions.invoke('deduction-join-room', {
      body: {
        room_id: roomId,
        display_name: user.email?.split('@')[0] || 'Player',
      },
    });

    if (!error) {
      navigate(`/deduction-game/${roomId}`);
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
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">{t('deduction_game.title')}</h1>
          <button
            onClick={fetchRooms}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">{t('deduction_game.lobby.open_rooms')}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rooms.length === 0 ? (
                <div className="col-span-full text-center py-12 text-gray-500 bg-white/5 rounded-lg border border-white/5 border-dashed">
                  {t('deduction_game.lobby.no_rooms')}
                </div>
              ) : (
                rooms.map((room) => {
                  const activePlayers = room.deduction_room_players?.filter((p: any) => !p.left_at) || [];
                  const onlinePlayers = activePlayers.filter((p: any) => p.is_online);
                  const maxPlayers = room.settings.max_players || 6;
                  const host = room.profiles;
                  const isUserInRoom = activePlayers.some((p: any) => p.user_id === user?.id);

                  return (
                    <div key={room.id} className="bg-gray-800 border border-white/10 rounded-lg p-5 hover:border-blue-500/50 transition-colors">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                          {host?.avatar_url ? (
                            <img src={host.avatar_url} className="w-10 h-10 rounded-full" alt="" />
                          ) : (
                            <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center">
                              <User className="w-5 h-5 text-gray-400" />
                            </div>
                          )}
                          <div>
                            <div className="font-bold">{host?.username || 'Host'}</div>
                            <div className="text-xs text-gray-500">{t('deduction_game.lobby.host')}</div>
                          </div>
                        </div>
                        <div className="bg-black/40 px-3 py-1 rounded-full text-sm font-mono">
                          <Users className="w-4 h-4 inline mr-1" />
                          {activePlayers.length}/{maxPlayers}
                        </div>
                      </div>

                      <div className="flex justify-between items-center mt-4">
                        <div className="text-sm text-gray-400">
                          {room.status === 'lobby' ? t('deduction_game.lobby.waiting') : t(`deduction_game.status.${room.status}`)}
                        </div>
                        <button
                          onClick={() => joinRoom(room.id)}
                          disabled={activePlayers.length >= maxPlayers && !isUserInRoom}
                          className={`px-4 py-2 rounded font-bold text-sm ${
                            activePlayers.length >= maxPlayers && !isUserInRoom
                              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                        >
                          {isUserInRoom ? t('deduction_game.lobby.rejoin') : t('deduction_game.lobby.join')}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-6">
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

            <div className="bg-gray-800 p-6 rounded-lg">
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
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 p-3 rounded font-bold flex items-center justify-center gap-2"
              >
                {creating ? t('deduction_game.lobby.creating') : <><Plus className="w-5 h-5" /> {t('deduction_game.lobby.create_room')}</>}
              </button>
            </div>

            <div className="bg-gray-800 p-6 rounded-lg">
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
      </div>
    </div>
  );
}
