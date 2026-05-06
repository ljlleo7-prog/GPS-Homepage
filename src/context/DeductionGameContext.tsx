import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { DeductionRoom, RoomPlayer, Race, SeasonState } from '@/types/deduction';

interface DeductionGameContextType {
  room: DeductionRoom | null;
  players: RoomPlayer[];
  currentPlayer: RoomPlayer | null;
  races: Race[];
  seasonState: SeasonState | null;
  loading: boolean;
  joinRoom: (roomId: string) => Promise<void>;
  submitAction: (actionType: string, target: string) => Promise<void>;
  submitVote: (targetPlayerId: string) => Promise<void>;
}

const DeductionGameContext = createContext<DeductionGameContextType | undefined>(undefined);

export function DeductionGameProvider({ children }: { children: React.ReactNode }) {
  const [room, setRoom] = useState<DeductionRoom | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<RoomPlayer | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [seasonState, setSeasonState] = useState<SeasonState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!room) return;

    const channel = supabase
      .channel(`room:${room.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'deduction_rooms',
        filter: `id=eq.${room.id}`,
      }, (payload) => {
        setRoom(payload.new as DeductionRoom);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'deduction_room_players',
        filter: `room_id=eq.${room.id}`,
      }, () => {
        loadPlayers(room.id);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'deduction_races',
        filter: `room_id=eq.${room.id}`,
      }, () => {
        loadRaces(room.id);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id]);

  const loadPlayers = async (roomId: string) => {
    const { data } = await supabase
      .from('deduction_room_players')
      .select('*')
      .eq('room_id', roomId)
      .order('seat_index');

    if (data) setPlayers(data);
  };

  const loadRaces = async (roomId: string) => {
    const { data } = await supabase
      .from('deduction_races')
      .select('*')
      .eq('room_id', roomId)
      .order('round_number');

    if (data) setRaces(data);
  };

  const joinRoom = async (roomId: string) => {
    setLoading(true);
    try {
      const { data: roomData } = await supabase
        .from('deduction_rooms')
        .select('*')
        .eq('id', roomId)
        .single();

      if (roomData) {
        setRoom(roomData);
        await loadPlayers(roomId);
        await loadRaces(roomId);

        const { data: seasonData } = await supabase
          .from('deduction_season_state')
          .select('*')
          .eq('room_id', roomId)
          .single();

        if (seasonData) setSeasonState(seasonData);

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const player = players.find(p => p.user_id === user.id);
          setCurrentPlayer(player || null);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const submitAction = async (actionType: string, target: string) => {
    if (!room || !currentPlayer) return;

    await supabase.from('deduction_actions').insert({
      room_id: room.id,
      round_number: room.current_round,
      player_id: currentPlayer.id,
      action_type: actionType,
      action_target: target,
    });
  };

  const submitVote = async (targetPlayerId: string) => {
    if (!room || !currentPlayer) return;

    await supabase.from('deduction_votes').insert({
      room_id: room.id,
      round_number: room.current_round,
      voter_player_id: currentPlayer.id,
      target_player_id: targetPlayerId,
    });
  };

  return (
    <DeductionGameContext.Provider value={{
      room,
      players,
      currentPlayer,
      races,
      seasonState,
      loading,
      joinRoom,
      submitAction,
      submitVote,
    }}>
      {children}
    </DeductionGameContext.Provider>
  );
}

export function useDeductionGame() {
  const context = useContext(DeductionGameContext);
  if (!context) throw new Error('useDeductionGame must be used within DeductionGameProvider');
  return context;
}
