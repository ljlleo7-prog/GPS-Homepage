import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Zap, Flag, Wrench } from 'lucide-react';
import ReactionGame from '../components/minigame/ReactionGame';
import OneLapDuel from '../components/minigame/OneLapDuel';
import PitStopGame from '../components/minigame/PitStopGame';

export default function Minigame() {
  const { t } = useTranslation();
  const [selectedGame, setSelectedGame] = useState<'REACTION' | 'DUEL' | 'PIT_STOP' | null>(null);

  if (!selectedGame) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white pt-24 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h1 className="text-5xl font-black mb-4">{t('minigame.title')}</h1>
            <p className="text-xl text-gray-400">{t('minigame.subtitle')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Reaction Game Card */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedGame('REACTION')}
              className="group relative h-[400px] bg-neutral-800 rounded-2xl overflow-hidden border border-white/5 hover:border-f1-red/50 transition-colors text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent z-10" />
              <div className="absolute inset-0 bg-[url('https://ts1.tc.mm.bing.net/th/id/OIP-C.meIJEDN0IeM3pc3DG5jW_gHaEK?rs=1&pid=ImgDetMain&o=7&rm=3')] bg-cover bg-center opacity-40 group-hover:opacity-60 transition-opacity" />
              
              <div className="relative z-20 p-8 h-full flex flex-col justify-end">
                <Zap className="w-12 h-12 text-f1-red mb-4" />
                <h2 className="text-3xl font-bold mb-2">{t('minigame.reaction.title')}</h2>
                <p className="text-gray-300 mb-4">{t('minigame.reaction.desc')}</p>
                <div className="flex items-center gap-2 text-sm font-mono text-f1-red">
                  <span>{t('minigame.reaction.tag_pool')}</span>
                  <span className="bg-f1-red text-white px-2 py-0.5 rounded">{t('minigame.reaction.tag_live')}</span>
                </div>
              </div>
            </motion.button>

            {/* One-Lap Duel Card */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedGame('DUEL')}
              className="group relative h-[400px] bg-neutral-800 rounded-2xl overflow-hidden border border-white/5 hover:border-blue-500/50 transition-colors text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent z-10" />
              <div className="absolute inset-0 bg-[url('https://simracingcockpit.com/wp-content/uploads/2023/02/featured-f1-overtake.jpg')] bg-cover bg-center opacity-40 group-hover:opacity-60 transition-opacity" />
              
              <div className="relative z-20 p-8 h-full flex flex-col justify-end">
                <Flag className="w-12 h-12 text-blue-500 mb-4" />
                <h2 className="text-3xl font-bold mb-2">{t('minigame.duel.title')}</h2>
                <p className="text-gray-300 mb-4">{t('minigame.duel.desc')}</p>
                <div className="flex items-center gap-2 text-sm font-mono text-blue-500">
                  <span>{t('minigame.duel.tag_strat')}</span>
                  <span className="bg-blue-600 text-white px-2 py-0.5 rounded">{t('minigame.duel.tag_new')}</span>
                </div>
              </div>
            </motion.button>

            {/* Pit Stop Challenge Card */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedGame('PIT_STOP')}
              className="group relative h-[400px] bg-neutral-800 rounded-2xl overflow-hidden border border-white/5 hover:border-yellow-500/50 transition-colors text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent z-10" />
              <div className="absolute inset-0 bg-[url('https://ts4.tc.mm.bing.net/th/id/OIP-C.vu3cpUZ5Np5bVqNw-9xyBwHaE7?rs=1&pid=ImgDetMain&o=7&rm=3')] bg-cover bg-center opacity-40 group-hover:opacity-60 transition-opacity" />
              
              <div className="relative z-20 p-8 h-full flex flex-col justify-end">
                <Wrench className="w-12 h-12 text-yellow-500 mb-4" />
                <h2 className="text-3xl font-bold mb-2">PIT STOP CHALLENGE</h2>
                <p className="text-gray-300 mb-4">Master the art of the perfect pit stop. Speed and precision are key.</p>
                <div className="flex items-center gap-2 text-sm font-mono text-yellow-500">
                  <span>SKILL & SPEED</span>
                  <span className="bg-yellow-600 text-white px-2 py-0.5 rounded">NEW</span>
                </div>
              </div>
            </motion.button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-white pt-24 px-4">
      <div className="max-w-6xl mx-auto">
        <button 
          onClick={() => setSelectedGame(null)}
          className="mb-8 text-gray-400 hover:text-white flex items-center gap-2 transition-colors"
        >
          ← {t('minigame.back')}
        </button>

        
        {selectedGame === 'REACTION' && <ReactionGame />}
        {selectedGame === 'DUEL' && <OneLapDuel />}
        {selectedGame === 'PIT_STOP' && <PitStopGame />}
      </div>
    </div>
  );
}
