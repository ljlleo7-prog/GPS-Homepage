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

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

export function DeductionGameProvider({ children }: { children: React.ReactNode }) {
  const [room, setRoom] = useState<DeductionRoom | null>(null);
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<RoomPlayer | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [seasonState, setSeasonState] = useState<SeasonState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!room?.id) return;

    const channel = supabase
      .channel(`deduction-room:${room.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
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
      }, async () => {
        const { data: { user } } = await supabase.auth.getUser();
        const { data } = await supabase
          .from('deduction_room_players_public')
          .select('*')
          .eq('room_id', room.id)
          .order('seat_index');
        if (data) {
          setPlayers(data as RoomPlayer[]);
          setCurrentPlayer((data as RoomPlayer[]).find((player) => player.user_id === user?.id) ?? null);
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'deduction_races',
        filter: `room_id=eq.${room.id}`,
      }, (payload) => {
        setRaces((current) => upsertById(current, payload.new as Race).sort((a, b) => a.round_number - b.round_number));
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'deduction_season_state',
        filter: `room_id=eq.${room.id}`,
      }, (payload) => {
        setSeasonState(payload.new as SeasonState);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id]);

  const joinRoom = async (roomId: string) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const [roomResult, playersResult, racesResult, seasonResult] = await Promise.all([
        supabase.from('deduction_rooms').select('*').eq('id', roomId).single(),
        supabase.from('deduction_room_players_public').select('*').eq('room_id', roomId).order('seat_index'),
        supabase.from('deduction_races').select('*').eq('room_id', roomId).order('round_number'),
        supabase.from('deduction_season_state').select('*').eq('room_id', roomId).maybeSingle(),
      ]);

      if (roomResult.error) throw roomResult.error;

      const nextPlayers = (playersResult.data ?? []) as RoomPlayer[];
      setRoom(roomResult.data as DeductionRoom);
      setPlayers(nextPlayers);
      setCurrentPlayer(nextPlayers.find((player) => player.user_id === user?.id) ?? null);
      setRaces((racesResult.data ?? []) as Race[]);
      setSeasonState((seasonResult.data as SeasonState | null) ?? null);
    } finally {
      setLoading(false);
    }
  };

  const submitAction = async (actionType: string, target: string) => {
    if (!room || !currentPlayer) return;

    await supabase.from('deduction_actions').upsert({
      room_id: room.id,
      round_number: room.current_round,
      player_id: currentPlayer.id,
      action_type: actionType,
      action_target: target,
    }, { onConflict: 'room_id,round_number,player_id' });
  };

  const submitVote = async (targetPlayerId: string) => {
    if (!room || !currentPlayer) return;

    await supabase.from('deduction_votes').upsert({
      room_id: room.id,
      round_number: room.current_round,
      voter_player_id: currentPlayer.id,
      target_player_id: targetPlayerId,
    }, { onConflict: 'room_id,round_number,voter_player_id' });
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
