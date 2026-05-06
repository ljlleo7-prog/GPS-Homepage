import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { room_id } = await req.json();

    const { data: room } = await supabase
      .from('deduction_rooms')
      .select('*')
      .eq('id', room_id)
      .single();

    if (!room) throw new Error('Room not found');

    const { data: votes } = await supabase
      .from('deduction_votes')
      .select('*')
      .eq('room_id', room_id)
      .eq('round_number', room.current_round);

    const voteCounts: Record<string, number> = {};
    votes?.forEach(vote => {
      voteCounts[vote.target_player_id] = (voteCounts[vote.target_player_id] || 0) + 1;
    });

    const sorted = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
    const toFire = sorted[0]?.[0];

    if (toFire) {
      await supabase
        .from('deduction_room_players')
        .update({
          is_alive: false,
          was_fired_round: room.current_round,
        })
        .eq('id', toFire);
    }

    const { data: players } = await supabase
      .from('deduction_room_players')
      .select('*')
      .eq('room_id', room_id);

    const alive = players?.filter(p => p.is_alive) || [];
    const negatives = alive.filter(p => p.alignment === 'negative');

    const { data: seasonState } = await supabase
      .from('deduction_season_state')
      .select('*')
      .eq('room_id', room_id)
      .single();

    let gameEnded = false;
    let winner = null;

    if (negatives.length === 0) {
      gameEnded = true;
      winner = 'positive';
    } else if (seasonState && seasonState.board_pressure >= seasonState.board_threshold) {
      gameEnded = true;
      winner = 'negative';
    }

    if (gameEnded) {
      await supabase
        .from('deduction_rooms')
        .update({
          status: 'ended',
          ended_at: new Date().toISOString(),
          winning_alignment: winner,
        })
        .eq('id', room_id);
    } else {
      await supabase
        .from('deduction_rooms')
        .update({ status: 'night_phase' })
        .eq('id', room_id);
    }

    return new Response(JSON.stringify({ success: true, gameEnded, winner }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
