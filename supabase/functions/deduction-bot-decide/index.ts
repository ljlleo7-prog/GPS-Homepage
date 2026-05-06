import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function seedRandom(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  return () => {
    hash = (hash * 9301 + 49297) % 233280;
    return hash / 233280;
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { room_id } = await req.json();

    const { data: room } = await supabase
      .from('deduction_rooms')
      .select('*')
      .eq('id', room_id)
      .single();

    if (!room) throw new Error('Room not found');

    const { data: players } = await supabase
      .from('deduction_room_players')
      .select('*')
      .eq('room_id', room_id);

    const bots = players?.filter(p => p.bot_id && p.is_alive) || [];

    for (const bot of bots) {
      const seed = `${room.season_seed}-${bot.id}-${room.current_round}`;
      const rng = seedRandom(seed);

      if (room.status === 'night_phase') {
        const existing = await supabase
          .from('deduction_actions')
          .select('id')
          .eq('room_id', room_id)
          .eq('round_number', room.current_round)
          .eq('player_id', bot.id)
          .single();

        if (!existing.data) {
          let actionType = null;
          let target = null;

          if (bot.role === 'TC') {
            target = rng() < 0.5 ? '1' : '2';
            actionType = bot.alignment === 'positive' ? 'tc_protect' : 'tc_sabotage';
          } else if (bot.role === 'IS' && bot.alignment === 'positive') {
            const alive = players?.filter(p => p.is_alive && p.id !== bot.id) || [];
            if (alive.length > 0) {
              target = alive[Math.floor(rng() * alive.length)].id;
              actionType = 'is_check';
            }
          }

          if (actionType) {
            await supabase.from('deduction_actions').insert({
              room_id,
              round_number: room.current_round,
              player_id: bot.id,
              action_type: actionType,
              action_target: target,
            });
          }
        }
      }

      if (room.status === 'voting') {
        const existing = await supabase
          .from('deduction_votes')
          .select('id')
          .eq('room_id', room_id)
          .eq('round_number', room.current_round)
          .eq('voter_player_id', bot.id)
          .single();

        if (!existing.data) {
          const alive = players?.filter(p => p.is_alive && p.id !== bot.id) || [];
          if (alive.length > 0) {
            const target = alive[Math.floor(rng() * alive.length)];
            await supabase.from('deduction_votes').insert({
              room_id,
              round_number: room.current_round,
              voter_player_id: bot.id,
              target_player_id: target.id,
            });
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, bots_processed: bots.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
