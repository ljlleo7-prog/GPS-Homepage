-- Create tables for One-Lap Duel game

-- 1. Driver Stats and Morale
CREATE TABLE IF NOT EXISTS public.one_lap_drivers (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    acceleration_skill FLOAT DEFAULT 10.0,
    braking_skill FLOAT DEFAULT 10.0,
    cornering_skill FLOAT DEFAULT 10.0,
    ers_efficiency_skill FLOAT DEFAULT 10.0,
    decision_making_skill FLOAT DEFAULT 10.0,
    morale FLOAT DEFAULT 100.0 CHECK (morale >= 0 AND morale <= 100),
    daily_dev_accumulated FLOAT DEFAULT 0.0,
    last_dev_reset TIMESTAMPTZ DEFAULT NOW(),
    last_training_update TIMESTAMPTZ DEFAULT NOW(),
    training_mode TEXT DEFAULT 'rest' CHECK (training_mode IN ('rest', 'light', 'intense')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Game Rooms
CREATE TABLE IF NOT EXISTS public.one_lap_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'racing', 'finished')),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Room Players (The lobby participants)
CREATE TABLE IF NOT EXISTS public.one_lap_room_players (
    room_id UUID REFERENCES public.one_lap_rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    strategy JSONB DEFAULT '{}'::JSONB, -- Stores ERS/Line choices
    is_ready BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);

-- 4. Race Results (History)
CREATE TABLE IF NOT EXISTS public.one_lap_races (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.one_lap_rooms(id),
    winner_id UUID REFERENCES public.profiles(id),
    simulation_log JSONB, -- Full replay data
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Leaderboard (Can be a view or table, using table for simplicity/performance)
CREATE TABLE IF NOT EXISTS public.one_lap_leaderboard (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    best_lap_time_ms INTEGER, -- Null means no time yet
    races_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    total_points INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.one_lap_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_lap_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_lap_room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_lap_races ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.one_lap_leaderboard ENABLE ROW LEVEL SECURITY;

-- Policies

-- Drivers
CREATE POLICY "Drivers viewable by everyone" ON public.one_lap_drivers FOR SELECT USING (true);
CREATE POLICY "Users can insert their own driver" ON public.one_lap_drivers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own training" ON public.one_lap_drivers FOR UPDATE USING (auth.uid() = user_id);

-- Rooms
CREATE POLICY "Rooms viewable by everyone" ON public.one_lap_rooms FOR SELECT USING (true);
CREATE POLICY "Users can create rooms" ON public.one_lap_rooms FOR INSERT WITH CHECK (auth.uid() = created_by);
-- Note: Update policy might be needed if users close rooms, but simulation does status updates. 
-- We'll allow room creator to update for now, or service role.
CREATE POLICY "Creator can update room" ON public.one_lap_rooms FOR UPDATE USING (auth.uid() = created_by);

-- Room Players
CREATE POLICY "Room players viewable by everyone" ON public.one_lap_room_players FOR SELECT USING (true);
CREATE POLICY "Users can join rooms" ON public.one_lap_room_players FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own status/strategy" ON public.one_lap_room_players FOR UPDATE USING (auth.uid() = user_id);

-- Races
CREATE POLICY "Races viewable by everyone" ON public.one_lap_races FOR SELECT USING (true);
-- Races are inserted by the system/edge function (service role), but if we do client-side sim for MVP:
CREATE POLICY "Participants can insert race results" ON public.one_lap_races FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.one_lap_room_players WHERE room_id = one_lap_races.room_id AND user_id = auth.uid())
);

-- Leaderboard
CREATE POLICY "Leaderboard viewable by everyone" ON public.one_lap_leaderboard FOR SELECT USING (true);
-- Updated by system usually.

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.one_lap_drivers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.one_lap_rooms TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.one_lap_room_players TO authenticated;
GRANT SELECT, INSERT ON public.one_lap_races TO authenticated;
GRANT SELECT ON public.one_lap_leaderboard TO authenticated;
