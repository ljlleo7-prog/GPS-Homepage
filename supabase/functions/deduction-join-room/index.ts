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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { room_id, display_name, fill_bots } = await req.json();

    const { data: room } = await supabase
      .from('deduction_rooms')
      .select('*')
      .eq('id', room_id)
      .single();

    if (!room || room.status !== 'lobby') {
      return new Response(JSON.stringify({ error: 'Room not available' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: existing } = await supabase
      .from('deduction_room_players')
      .select('*')
      .eq('room_id', room_id);

    const maxPlayers = room.settings.max_players || 6;
    if (existing && existing.length >= maxPlayers) {
      return new Response(JSON.stringify({ error: 'Room full' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const nextSeat = existing ? existing.length : 0;

    await supabase.from('deduction_room_players').insert({
      room_id,
      seat_index: nextSeat,
      user_id: user.id,
      display_name: display_name || 'Player',
      role: 'TC',
      alignment: 'positive',
    });

    if (fill_bots && room.settings.allow_bots) {
      const currentCount = (existing?.length || 0) + 1;
      for (let i = currentCount; i < maxPlayers; i++) {
        await supabase.from('deduction_room_players').insert({
          room_id,
          seat_index: i,
          bot_id: `bot-${i}`,
          display_name: `Bot ${i}`,
          role: 'TC',
          alignment: 'positive',
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
