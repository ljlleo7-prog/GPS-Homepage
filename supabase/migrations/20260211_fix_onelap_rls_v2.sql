-- Fix RLS policies for One Lap Duel to allow proper exit/delete logic

-- 1. Policies for one_lap_rooms
ALTER TABLE one_lap_rooms ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read rooms (Lobby)
DROP POLICY IF EXISTS "Anyone can view rooms" ON one_lap_rooms;
CREATE POLICY "Anyone can view rooms" ON one_lap_rooms
    FOR SELECT USING (true);

-- Allow authenticated users to create rooms
DROP POLICY IF EXISTS "Authenticated users can create rooms" ON one_lap_rooms;
CREATE POLICY "Authenticated users can create rooms" ON one_lap_rooms
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Allow HOST (created_by) to delete their own room
DROP POLICY IF EXISTS "Hosts can delete their own rooms" ON one_lap_rooms;
CREATE POLICY "Hosts can delete their own rooms" ON one_lap_rooms
    FOR DELETE USING (auth.uid() = created_by);

-- Allow HOST to update their room (e.g. status)
DROP POLICY IF EXISTS "Hosts can update their own rooms" ON one_lap_rooms;
CREATE POLICY "Hosts can update their own rooms" ON one_lap_rooms
    FOR UPDATE USING (auth.uid() = created_by);


-- 2. Policies for one_lap_room_players
ALTER TABLE one_lap_room_players ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view players (Lobby/Room)
DROP POLICY IF EXISTS "Anyone can view room players" ON one_lap_room_players;
CREATE POLICY "Anyone can view room players" ON one_lap_room_players
    FOR SELECT USING (true);

-- Allow authenticated users to join (insert themselves)
DROP POLICY IF EXISTS "Users can join rooms" ON one_lap_room_players;
CREATE POLICY "Users can join rooms" ON one_lap_room_players
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow Users to leave (delete their own row) AND Hosts to kick (delete any row in their room)
DROP POLICY IF EXISTS "Users can leave or Host can kick" ON one_lap_room_players;
CREATE POLICY "Users can leave or Host can kick" ON one_lap_room_players
    FOR DELETE USING (
        auth.uid() = user_id -- User leaving
        OR 
        room_id IN ( -- Host kicking
            SELECT id FROM one_lap_rooms WHERE created_by = auth.uid()
        )
    );
