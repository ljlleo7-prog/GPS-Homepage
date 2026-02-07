import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../context/AuthContext';
import { useEconomy } from '../../../context/EconomyContext';
import { supabase } from '../../../lib/supabase';
import Dashboard from './Dashboard';
import Lobby from './Lobby';
import Room from './Room';
import Leaderboard from './Leaderboard';
import { DriverStats } from './types';

export default function OneLapDuel() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [activeView, setActiveView] = useState<'DASHBOARD' | 'LOBBY' | 'ROOM' | 'LEADERBOARD'>('DASHBOARD');
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverStats | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);

  // Presence
  useEffect(() => {
    const channel = supabase.channel('one_lap_lobby');
    
    channel
        .on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState();
            setOnlineCount(Object.keys(state).length);
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED' && user) {
                await channel.track({ user_id: user.id });
            }
        });

    return () => {
        supabase.removeChannel(channel);
    };
  }, [user]);

  // Fetch driver stats
  useEffect(() => {
    if (user) {
      fetchDriver();
    }
  }, [user]);

  const fetchDriver = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('one_lap_drivers')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error && error.code === 'PGRST116') {
      // Create driver if not exists
      const { data: newDriver } = await supabase
        .from('one_lap_drivers')
        .insert([{ user_id: user.id }])
        .select()
        .single();
      
      if (newDriver) setDriver(newDriver);
    } else if (data) {
      // Calculate Passive Growth
      const lastUpdate = new Date(data.last_training_update).getTime();
      const now = Date.now();
      const hoursElapsed = (now - lastUpdate) / (1000 * 60 * 60);

      if (hoursElapsed >= 1) {
          // Update stats
          const BASE_RATE = 0.05;
          const DAILY_CAP = 2.0;
          const moraleFactor = data.morale > 80 ? 1.1 : data.morale < 40 ? 0.9 : 1.0;
          
          let skillRate = 0;
          let moraleChangeRate = 0;

          if (data.training_mode === 'intense') {
              skillRate = BASE_RATE * 2 * moraleFactor;
              moraleChangeRate = -1;
          } else if (data.training_mode === 'light') {
              skillRate = BASE_RATE * moraleFactor;
              moraleChangeRate = 0.2;
          } else { // Rest
              skillRate = 0;
              moraleChangeRate = 1.0;
          }

          // Check daily reset (simplified: just check if last update was previous day)
          // Ideally we reset daily_dev_accumulated at 00:00 UTC. 
          // Here we just check if day changed.
          const lastDate = new Date(data.last_training_update).getUTCDate();
          const nowDate = new Date().getUTCDate();
          let currentDaily = data.daily_dev_accumulated;
          if (lastDate !== nowDate) {
              currentDaily = 0;
          }

          const maxGain = Math.max(0, DAILY_CAP - currentDaily);
          const totalSkillGain = Math.min(skillRate * hoursElapsed, maxGain);
          const totalMoraleChange = moraleChangeRate * hoursElapsed;

          if (totalSkillGain > 0 || Math.abs(totalMoraleChange) > 0 || lastDate !== nowDate) {
              const gainPerSkill = totalSkillGain / 5;
              const newStats = {
                  acceleration_skill: data.acceleration_skill + gainPerSkill,
                  braking_skill: data.braking_skill + gainPerSkill,
                  cornering_skill: data.cornering_skill + gainPerSkill,
                  ers_efficiency_skill: data.ers_efficiency_skill + gainPerSkill,
                  decision_making_skill: data.decision_making_skill + gainPerSkill,
                  morale: Math.max(0, Math.min(100, data.morale + totalMoraleChange)),
                  daily_dev_accumulated: currentDaily + totalSkillGain,
                  last_training_update: new Date().toISOString()
              };

              await supabase.from('one_lap_drivers').update(newStats).eq('user_id', user.id);
              setDriver({ ...data, ...newStats });
              return;
          }
      }
      setDriver(data);
    }
  };

  const handleJoinRoom = (roomId: string) => {
    setCurrentRoomId(roomId);
    setActiveView('ROOM');
  };

  const handleLeaveRoom = () => {
    setCurrentRoomId(null);
    setActiveView('LOBBY');
  };

  if (!user) {
    return <div className="text-center p-8">{t('minigame_onelapduel.common.login_required')}</div>;
  }

  return (
    <div className="animate-fade-in bg-neutral-900 rounded-lg p-6 min-h-[600px]">
      {/* Navigation */}
      <div className="flex justify-between items-center mb-8 border-b border-white/10 pb-4">
        <div className="flex gap-4">
          <button 
            onClick={() => setActiveView('DASHBOARD')}
            className={`px-4 py-2 font-bold ${activeView === 'DASHBOARD' ? 'text-f1-red border-b-2 border-f1-red' : 'text-gray-400'}`}
          >
            {t('minigame_onelapduel.nav.driver_hq')}
          </button>
          <button 
            onClick={() => setActiveView('LOBBY')}
            className={`px-4 py-2 font-bold ${activeView === 'LOBBY' ? 'text-f1-red border-b-2 border-f1-red' : 'text-gray-400'}`}
          >
            {t('minigame_onelapduel.nav.race_lobby')}
          </button>
          <button 
            onClick={() => setActiveView('LEADERBOARD')}
            className={`px-4 py-2 font-bold ${activeView === 'LEADERBOARD' ? 'text-f1-red border-b-2 border-f1-red' : 'text-gray-400'}`}
          >
            {t('minigame_onelapduel.nav.standings')}
          </button>
          {currentRoomId && (
            <button 
              onClick={() => setActiveView('ROOM')}
              className={`px-4 py-2 font-bold ${activeView === 'ROOM' ? 'text-f1-red border-b-2 border-f1-red' : 'text-gray-400'}`}
            >
              {t('minigame_onelapduel.nav.current_race')}
            </button>
          )}
        </div>
        
        {/* Global Online Count */}
        <div className="text-sm text-green-400 flex items-center gap-2 bg-black/20 px-3 py-1 rounded-full">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="font-mono font-bold">{onlineCount}</span> {t('minigame_onelapduel.nav.online')}
        </div>
      </div>

      {activeView === 'DASHBOARD' && driver && (
        <Dashboard driver={driver} onUpdate={fetchDriver} />
      )}

      {activeView === 'LOBBY' && (
        <Lobby onJoin={handleJoinRoom} onlineCount={onlineCount} />
      )}

      {activeView === 'LEADERBOARD' && (
        <Leaderboard />
      )}

      {activeView === 'ROOM' && currentRoomId && driver && (
        <Room roomId={currentRoomId} driver={driver} onLeave={handleLeaveRoom} />
      )}
    </div>
  );
}
