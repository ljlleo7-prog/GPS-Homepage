import { DriverStats } from './types';
import { supabase } from '../../../lib/supabase';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Gauge, Zap, Activity, Heart, Calendar } from 'lucide-react';

interface Props {
  driver: DriverStats;
  onUpdate: () => void;
}

export default function Dashboard({ driver, onUpdate }: Props) {
  const { t } = useTranslation();
  const [updating, setUpdating] = useState(false);

  const updateTraining = async (mode: 'rest' | 'light' | 'intense') => {
    setUpdating(true);
    const { error } = await supabase
      .from('one_lap_drivers')
      .update({ training_mode: mode })
      .eq('user_id', driver.user_id);
    
    if (!error) {
      onUpdate();
    }
    setUpdating(false);
  };

  const skills = [
    { name: t('minigame_onelapduel.dashboard.skills.acceleration'), value: driver.acceleration_skill, icon: Gauge, color: 'text-blue-400' },
    { name: t('minigame_onelapduel.dashboard.skills.braking'), value: driver.braking_skill, icon: Activity, color: 'text-red-400' },
    { name: t('minigame_onelapduel.dashboard.skills.cornering'), value: driver.cornering_skill, icon: Zap, color: 'text-yellow-400' },
    { name: t('minigame_onelapduel.dashboard.skills.ers_efficiency'), value: driver.ers_efficiency_skill, icon: Zap, color: 'text-green-400' },
    { name: t('minigame_onelapduel.dashboard.skills.decision_making'), value: driver.decision_making_skill, icon: Brain, color: 'text-purple-400' },
  ];

  // Training descriptions
  const trainingModes = {
    rest: { label: t('minigame_onelapduel.dashboard.training_modes.rest.label'), desc: t('minigame_onelapduel.dashboard.training_modes.rest.desc'), impact: t('minigame_onelapduel.dashboard.training_modes.rest.impact') },
    light: { label: t('minigame_onelapduel.dashboard.training_modes.light.label'), desc: t('minigame_onelapduel.dashboard.training_modes.light.desc'), impact: t('minigame_onelapduel.dashboard.training_modes.light.impact') },
    intense: { label: t('minigame_onelapduel.dashboard.training_modes.intense.label'), desc: t('minigame_onelapduel.dashboard.training_modes.intense.desc'), impact: t('minigame_onelapduel.dashboard.training_modes.intense.impact') },
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Stats Column */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Brain className="w-6 h-6 text-f1-red" />
          {t('minigame_onelapduel.dashboard.stats_title')}
        </h2>
        
        <div className="bg-black/40 p-6 rounded-lg border border-white/10">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Heart className={`w-8 h-8 ${driver.morale > 80 ? 'text-green-500' : driver.morale < 40 ? 'text-red-500' : 'text-yellow-500'}`} />
              <div>
                <div className="text-sm text-gray-400">{t('minigame_onelapduel.dashboard.skills.morale')}</div>
                <div className="text-2xl font-bold">{Math.round(driver.morale)}%</div>
              </div>
            </div>
            <div className="text-right text-sm text-gray-500 max-w-[150px]">
                {driver.morale > 80 ? t('minigame_onelapduel.dashboard.morale_high_desc') : t('minigame_onelapduel.dashboard.morale_low_desc')}
            </div>
          </div>

          <div className="space-y-4">
            {skills.map((skill) => (
              <div key={skill.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-300 flex items-center gap-2">
                    <skill.icon className={`w-4 h-4 ${skill.color}`} />
                    {skill.name}
                  </span>
                  <span className="font-mono font-bold">{skill.value.toFixed(1)}</span>
                </div>
                <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${skill.color.replace('text-', 'bg-')}`} 
                    style={{ width: `${(skill.value / 20) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Training Column */}
      <div>
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Calendar className="w-6 h-6 text-f1-red" />
          {t('minigame_onelapduel.dashboard.training_schedule')}
        </h2>

        <div className="grid gap-4">
          {(['rest', 'light', 'intense'] as const).map((mode) => {
            const isSelected = driver.training_mode === mode;
            return (
              <button
                key={mode}
                onClick={() => updateTraining(mode)}
                disabled={updating}
                className={`text-left p-4 rounded-lg border transition-all ${
                  isSelected 
                    ? 'bg-f1-red/20 border-f1-red' 
                    : 'bg-surface border-white/10 hover:border-white/30'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className={`font-bold ${isSelected ? 'text-f1-red' : 'text-white'}`}>
                    {trainingModes[mode].label}
                  </span>
                  {isSelected && <span className="text-xs bg-f1-red text-white px-2 py-0.5 rounded">ACTIVE</span>}
                </div>
                <p className="text-sm text-gray-400 mb-2">{trainingModes[mode].desc}</p>
                <div className="text-xs font-mono text-gray-500">{trainingModes[mode].impact}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 p-4 bg-blue-900/20 border border-blue-800 rounded text-sm text-blue-300">
          <p>Training updates happen daily. Ensure your schedule is set before the daily reset (00:00 UTC).</p>
        </div>
      </div>
    </div>
  );
}
