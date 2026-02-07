import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { Plus, User, RefreshCw, Play } from 'lucide-react';

interface Props {
  onJoin: (roomId: string) => void;
  onlineCount: number;
}

export default function Lobby({ onJoin, onlineCount }: Props) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchRooms();
    
    // Subscribe to new rooms
    const channel = supabase
      .channel('public:one_lap_rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'one_lap_rooms' }, () => {
        fetchRooms();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchRooms = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('one_lap_rooms')
      .select(`
        *,
        one_lap_room_players (
            user_id,
            is_ready
        ),
        profiles:created_by (username, avatar_url)
      `)
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    
    if (data) setRooms(data);
    setLoading(false);
  };

  const createRoom = async () => {
    if (!user) return;
    setCreating(true);
    
    // 1. Create Room
    const { data: room, error } = await supabase
      .from('one_lap_rooms')
      .insert([{ created_by: user.id, status: 'open' }])
      .select()
      .single();

    if (error) {
        console.error(error);
        setCreating(false);
        return;
    }

    // 2. Add self as player
    const { error: joinError } = await supabase
      .from('one_lap_room_players')
      .insert([{ room_id: room.id, user_id: user.id, is_ready: false }]);

    if (joinError) {
        console.error(joinError);
    } else {
        onJoin(room.id);
    }
    setCreating(false);
  };

  const joinRoom = async (roomId: string) => {
    if (!user) return;
    // Check if already in
    const { data: existing } = await supabase
        .from('one_lap_room_players')
        .select('*')
        .eq('room_id', roomId)
        .eq('user_id', user.id)
        .single();
    
    if (existing) {
        onJoin(roomId);
        return;
    }

    // Join
    const { error } = await supabase
        .from('one_lap_room_players')
        .insert([{ room_id: roomId, user_id: user.id, is_ready: false }]);
    
    if (!error) {
        onJoin(roomId);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
            <h2 className="text-2xl font-bold">Race Lobby</h2>
            <div className="text-sm text-green-400 flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                {onlineCount} Pilots Online
            </div>
        </div>
        <div className="flex gap-2">
            <button 
                onClick={fetchRooms}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
                onClick={createRoom}
                disabled={creating}
                className="bg-f1-red hover:bg-red-700 text-white font-bold py-2 px-6 rounded-full flex items-center gap-2"
            >
                {creating ? 'Creating...' : <><Plus className="w-5 h-5" /> Create Room</>}
            </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rooms.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-500 bg-white/5 rounded-lg border border-white/5 border-dashed">
                No open races found. Start one!
            </div>
        ) : (
            rooms.map((room) => {
                const playerCount = room.one_lap_room_players?.length || 0;
                const creator = room.profiles;
                return (
                    <div key={room.id} className="bg-surface border border-white/10 rounded-lg p-5 hover:border-f1-red/50 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                {creator?.avatar_url ? (
                                    <img src={creator.avatar_url} className="w-10 h-10 rounded-full" />
                                ) : (
                                    <div className="w-10 h-10 bg-neutral-700 rounded-full flex items-center justify-center">
                                        <User className="w-5 h-5 text-gray-400" />
                                    </div>
                                )}
                                <div>
                                    <div className="font-bold">{creator?.username || 'Unknown'}</div>
                                    <div className="text-xs text-gray-500">Host</div>
                                </div>
                            </div>
                            <div className="bg-black/40 px-3 py-1 rounded-full text-sm font-mono">
                                {playerCount}/2
                            </div>
                        </div>

                        <div className="flex justify-between items-center mt-4">
                            <div className="text-sm text-gray-400">
                                Monza GP (1 Lap)
                            </div>
                            <button
                                onClick={() => joinRoom(room.id)}
                                disabled={playerCount >= 2 && !room.one_lap_room_players.some((p: any) => p.user_id === user?.id)}
                                className={`px-4 py-2 rounded font-bold text-sm ${
                                    playerCount >= 2 && !room.one_lap_room_players.some((p: any) => p.user_id === user?.id)
                                    ? 'bg-neutral-800 text-gray-500 cursor-not-allowed'
                                    : 'bg-white text-black hover:bg-gray-200'
                                }`}
                            >
                                {room.one_lap_room_players.some((p: any) => p.user_id === user?.id) ? 'Rejoin' : 'Join Race'}
                            </button>
                        </div>
                    </div>
                );
            })
        )}
      </div>
    </div>
  );
}
