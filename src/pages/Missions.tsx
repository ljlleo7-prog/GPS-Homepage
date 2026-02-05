import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { CheckCircle, AlertCircle, Clock } from 'lucide-react';

interface Mission {
  id: string;
  title: string;
  description: string;
  reward_tokens: number;
  reward_rep: number;
  type: string;
  status: string;
}

const Missions = () => {
  const { user } = useAuth();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    fetchMissions();
  }, []);

  const fetchMissions = async () => {
    const { data, error } = await supabase
      .from('missions')
      .select('*')
      .eq('status', 'ACTIVE');
    
    if (error) console.error(error);
    else setMissions(data || []);
    setLoading(false);
  };

  const handleSubmit = async (missionId: string) => {
    if (!user || !feedback.trim()) return;
    setSubmitting(missionId);

    try {
      const { error } = await supabase
        .from('mission_submissions')
        .insert({
          mission_id: missionId,
          user_id: user.id,
          content: feedback,
          status: 'PENDING'
        });

      if (error) throw error;
      alert('Mission submitted successfully! Pending approval.');
      setFeedback('');
    } catch (error: any) {
      alert('Error submitting mission: ' + error.message);
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) return <div className="pt-24 text-center text-white">Loading Missions...</div>;

  return (
    <div className="min-h-screen bg-background pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-bold font-mono text-white mb-4">Community Missions</h1>
          <p className="text-text-secondary">Complete tasks to earn Tokens and Reputation.</p>
        </div>

        <div className="space-y-6">
          {missions.map((mission) => (
            <motion.div
              key={mission.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-surface border border-white/10 rounded-lg p-6"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center space-x-3 mb-2">
                    <span className="text-xs font-mono bg-primary/20 text-primary px-2 py-1 rounded border border-primary/30">
                      {mission.type}
                    </span>
                    <h3 className="text-xl font-bold text-white font-mono">{mission.title}</h3>
                  </div>
                  <p className="text-text-secondary text-sm mb-4">{mission.description}</p>
                </div>
                <div className="text-right">
                  <div className="text-primary font-bold font-mono">+{mission.reward_tokens} Tokens</div>
                  <div className="text-secondary font-bold font-mono">+{mission.reward_rep} Rep</div>
                </div>
              </div>

              {user ? (
                <div className="mt-4 pt-4 border-t border-white/5">
                  <textarea
                    placeholder="Enter your submission (feedback, link, or description)..."
                    className="w-full bg-background border border-white/10 rounded p-3 text-white text-sm mb-3 focus:border-primary focus:outline-none"
                    rows={3}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <button
                    onClick={() => handleSubmit(mission.id)}
                    disabled={!!submitting}
                    className="bg-primary text-background px-4 py-2 rounded font-mono font-bold text-sm hover:bg-secondary transition-colors disabled:opacity-50"
                  >
                    {submitting === mission.id ? 'Submitting...' : 'Submit Mission'}
                  </button>
                </div>
              ) : (
                <div className="mt-4 text-sm text-text-secondary italic">
                  Log in to participate.
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Missions;
