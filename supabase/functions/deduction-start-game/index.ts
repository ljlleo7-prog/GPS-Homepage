import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ROLE_SEQUENCE = ['TC', 'IS', 'ST'];
const DEFAULT_NEGATIVE_COUNTS: Record<number, number> = {
  4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 2, 11: 3, 12: 3,
};

function assignRoles(count: number): string[] {
  const roles = ['TP'];
  for (let i = 1; i < count; i++) {
    roles.push(ROLE_SEQUENCE[(i - 1) % ROLE_SEQUENCE.length]);
  }
  return roles;
}

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

    const { room_id } = await req.json();

    const { data: room } = await supabase
      .from('deduction_rooms')
      .select('*')
      .eq('id', room_id)
      .single();

    if (!room) {
      return new Response(JSON.stringify({ error: 'Room not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Allow host or any authenticated user (for auto-start)
    if (room.status !== 'lobby') {
      return new Response(JSON.stringify({ error: 'Room already started' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: players } = await supabase
      .from('deduction_room_players')
      .select('*')
      .eq('room_id', room_id)
      .is('user_id', 'not.null')
      .is('left_at', null)
      .order('seat_index');

    if (!players || players.length < 4) {
      return new Response(JSON.stringify({ error: 'Need at least 4 human players' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const roles = assignRoles(players.length);
    const negCount = room.settings.negative_count ?? DEFAULT_NEGATIVE_COUNTS[players.length];

    const rng = seedRandom(room.season_seed);
    const shuffled = [...players].sort(() => rng() - 0.5);
    const negatives = new Set(shuffled.slice(0, negCount).map(p => p.id));

    for (let i = 0; i < players.length; i++) {
      await supabase
        .from('deduction_room_players')
        .update({
          role: roles[i],
          alignment: negatives.has(players[i].id) ? 'negative' : 'positive',
          is_tp: roles[i] === 'TP',
        })
        .eq('id', players[i].id);
    }

    await supabase
      .from('deduction_season_state')
      .insert({ room_id });

    await supabase
      .from('deduction_rooms')
      .update({ status: 'night_phase', started_at: new Date().toISOString() })
      .eq('id', room_id);

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
