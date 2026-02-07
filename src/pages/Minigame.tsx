import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Zap, Flag } from 'lucide-react';
import ReactionGame from '../components/minigame/ReactionGame';
import OneLapDuel from '../components/minigame/OneLapDuel';

export default function Minigame() {
  const { t } = useTranslation();
  const [selectedGame, setSelectedGame] = useState<'REACTION' | 'DUEL' | null>(null);

  if (!selectedGame) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white pt-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h1 className="text-5xl font-black mb-4">PADDOCK CLUB</h1>
            <p className="text-xl text-gray-400">Select your challenge</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Reaction Game Card */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedGame('REACTION')}
              className="group relative h-[400px] bg-neutral-800 rounded-2xl overflow-hidden border border-white/5 hover:border-f1-red/50 transition-colors text-left"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent z-10" />
              <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1534077677847-a8439d5b4bdf?q=80&w=1000&auto=format&fit=crop')] bg-cover bg-center opacity-40 group-hover:opacity-60 transition-opacity" />
              
              <div className="relative z-20 p-8 h-full flex flex-col justify-end">
                <Zap className="w-12 h-12 text-f1-red mb-4" />
                <h2 className="text-3xl font-bold mb-2">F1 Reaction Test</h2>
                <p className="text-gray-300 mb-4">Test your reflexes against the 5 red lights. Can you beat an F1 driver's reaction time?</p>
                <div className="flex items-center gap-2 text-sm font-mono text-f1-red">
                  <span>MONTHLY PRIZE POOL</span>
                  <span className="bg-f1-red text-white px-2 py-0.5 rounded">LIVE</span>
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
              <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1596559987843-d9d3000673d6?q=80&w=1000&auto=format&fit=crop')] bg-cover bg-center opacity-40 group-hover:opacity-60 transition-opacity" />
              
              <div className="relative z-20 p-8 h-full flex flex-col justify-end">
                <Flag className="w-12 h-12 text-blue-500 mb-4" />
                <h2 className="text-3xl font-bold mb-2">One-Lap Duel (2026)</h2>
                <p className="text-gray-300 mb-4">Strategic 1v1 racing. Manage ERS, choose racing lines, and develop your driver.</p>
                <div className="flex items-center gap-2 text-sm font-mono text-blue-500">
                  <span>STRATEGY SIMULATION</span>
                  <span className="bg-blue-600 text-white px-2 py-0.5 rounded">NEW</span>
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
          ← Back to Games
        </button>
        
        {selectedGame === 'REACTION' && <ReactionGame />}
        {selectedGame === 'DUEL' && <OneLapDuel />}
      </div>
    </div>
  );
}
