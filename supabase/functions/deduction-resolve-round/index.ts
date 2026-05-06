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

    const round = room.current_round + 1;
    const roundSeed = `${room.season_seed}-r${round}`;
    const rng = seedRandom(roundSeed);

    const { data: actions } = await supabase
      .from('deduction_actions')
      .select('*')
      .eq('room_id', room_id)
      .eq('round_number', round);

    const sabotaged = new Set<number>();
    const protectedDrivers = new Set<number>();

    actions?.forEach(action => {
      if (action.action_type === 'tc_sabotage') {
        const driver = parseInt(action.action_target || '0');
        if (driver) sabotaged.add(driver);
      }
      if (action.action_type === 'tc_protect') {
        const driver = parseInt(action.action_target || '0');
        if (driver) protectedDrivers.add(driver);
      }
    });

    const baseDNF = room.settings.base_dnf_rate || 0.2;
    const driver1DNF = rng() < (baseDNF + (sabotaged.has(1) && !protectedDrivers.has(1) ? 0.4 : 0));
    const driver2DNF = rng() < (baseDNF + (sabotaged.has(2) && !protectedDrivers.has(2) ? 0.4 : 0));

    const { data: seasonState } = await supabase
      .from('deduction_season_state')
      .select('*')
      .eq('room_id', room_id)
      .single();

    let boardPressure = seasonState?.board_pressure || 0;
    let consecutiveDNFs = seasonState?.consecutive_dnfs || 0;

    if (driver1DNF || driver2DNF) {
      consecutiveDNFs++;
      boardPressure += 5;
    } else {
      consecutiveDNFs = 0;
    }

    if (driver1DNF && driver2DNF) {
      boardPressure += 10;
    }

    await supabase
      .from('deduction_season_state')
      .update({
        board_pressure: boardPressure,
        consecutive_dnfs: consecutiveDNFs,
      })
      .eq('room_id', room_id);

    const report = `Round ${round}: ${driver1DNF ? 'Driver 1 DNF' : 'Driver 1 finished'}. ${driver2DNF ? 'Driver 2 DNF' : 'Driver 2 finished'}. Board pressure: ${boardPressure}`;

    await supabase
      .from('deduction_races')
      .insert({
        room_id,
        round_number: round,
        track_name: 'Track ' + round,
        round_seed: roundSeed,
        driver_1_dnf: driver1DNF,
        driver_2_dnf: driver2DNF,
        public_report: report,
      });

    await supabase
      .from('deduction_rooms')
      .update({
        status: 'discussion',
        current_round: round,
      })
      .eq('id', room_id);

    return new Response(JSON.stringify({ success: true, report }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
