import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useEconomy } from '../context/EconomyContext';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, Clock, XCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Mission {
  id: string;
  title: string;
  description: string;
  reward_tokens: number;
  reward_rep: number;
  is_variable_reward: boolean;
  reward_min?: number;
  reward_max?: number;
  reward_rep_min?: number;
  reward_rep_max?: number;
  deadline?: string;
  type: string;
  status: string;
}

interface Submission {
  id: string;
  mission_id: string;
  status: string;
  payout_tokens: number | null;
  payout_rep: number | null;
  created_at: string;
  admin_feedback?: string;
}

const Missions = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { wallet, createUserCampaign } = useEconomy();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  // Create Mission Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newMissionTitle, setNewMissionTitle] = useState('');
  const [newMissionDesc, setNewMissionDesc] = useState('');
  const [newRewardMin, setNewRewardMin] = useState('');
  const [newRewardMax, setNewRewardMax] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    try {
      // Fetch Missions
      const { data: missionsData, error: missionsError } = await supabase
        .from('missions')
        .select('*')
        .eq('status', 'ACTIVE');
      
      if (missionsError) throw missionsError;
      setMissions(missionsData || []);

      // Fetch User Submissions if logged in
      if (user) {
        const { data: subData, error: subError } = await supabase
          .from('mission_submissions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        
        if (subError) throw subError;
        setSubmissions(subData || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const isExpired = (deadline?: string) => {
    if (!deadline) return false;
    return new Date(deadline) < new Date();
  };

  const handleSubmit = async (missionId: string) => {
    if (!user || !feedback.trim()) return;

    // Check deadline
    const mission = missions.find(m => m.id === missionId);
    if (mission && isExpired(mission.deadline)) {
      alert('This mission has expired.');
      return;
    }

    // Reputation Gating > 30
    if (!wallet || wallet.reputation_balance <= 30) {
      alert(t('economy.missions.low_rep'));
      return;
    }

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
      alert(t('economy.missions.success_msg'));
      setFeedback('');
      // Refresh submissions
      fetchData();
    } catch (error: any) {
      alert(t('economy.missions.error_msg') + error.message);
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreateMission = async () => {
    if (!newMissionTitle || !newMissionDesc || !newRewardMax) return;
    setCreating(true);
    const result = await createUserCampaign(
      'MISSION',
      newMissionTitle,
      newMissionDesc,
      parseInt(newRewardMin) || 0,
      parseInt(newRewardMax) || 0
    );

    if (result.success) {
      alert(t('economy.missions.launched_success'));
      setShowCreateModal(false);
      setNewMissionTitle('');
      setNewMissionDesc('');
      setNewRewardMin('');
      setNewRewardMax('');
      fetchData();
    } else {
      alert(result.message);
    }
    setCreating(false);
  };

  const getMissionSubmissions = (missionId: string) => {
    return submissions.filter(s => s.mission_id === missionId);
  };

  if (loading) return <div className="pt-24 text-center text-white">{t('economy.missions.loading')}</div>;

  return (
    <div className="min-h-screen bg-background pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-12 text-center relative">
          <h1 className="text-3xl font-bold font-mono text-white mb-4">{t('economy.missions.title')}</h1>
          <p className="text-text-secondary">{t('economy.missions.subtitle')}</p>
          
          {wallet && wallet.reputation_balance > 70 && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="absolute right-0 top-0 hidden md:flex items-center gap-2 bg-primary/20 text-primary border border-primary/50 px-4 py-2 rounded hover:bg-primary/30 transition-colors"
            >
              <Plus size={16} />
              {t('economy.missions.create_btn')}
            </button>
          )}
        </div>

        {/* Mobile Create Button */}
        {wallet && wallet.reputation_balance > 70 && (
          <div className="md:hidden mb-6 flex justify-center">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-primary/20 text-primary border border-primary/50 px-4 py-2 rounded hover:bg-primary/30 transition-colors"
            >
              <Plus size={16} />
              {t('economy.missions.create_btn')}
            </button>
          </div>
        )}

        <div className="space-y-6">
          {missions.map((mission) => {
            const missionSubmissions = getMissionSubmissions(mission.id);
            
            return (
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
                      {mission.deadline && (
                        <span className={`text-xs px-2 py-0.5 rounded ml-2 border ${isExpired(mission.deadline) ? 'text-red-500 border-red-500/50' : 'text-red-400 border-red-400/30'}`}>
                           {isExpired(mission.deadline) ? 'Expired' : `Deadline: ${new Date(mission.deadline).toLocaleDateString()}`}
                        </span>
                      )}
                    </div>
                    <p className="text-text-secondary text-sm mb-4">{mission.description}</p>
                  </div>
                  <div className="text-right">
                    {mission.is_variable_reward ? (
                       <div className="flex flex-col items-end">
                         <div className="text-primary font-bold font-mono">{t('economy.missions.variable_reward')}</div>
                         <div className="text-xs text-text-secondary">
                           {mission.reward_min}-{mission.reward_max} Tokens
                         </div>
                         {mission.reward_rep_max && mission.reward_rep_max > 0 && (
                            <div className="text-xs text-text-secondary">
                              {mission.reward_rep_min}-{mission.reward_rep_max} Rep
                            </div>
                         )}
                         <div className="text-sm text-green-400 font-mono mt-1">
                           {t('economy.missions.current_reward', { amount: mission.reward_tokens })}
                         </div>
                       </div>
                    ) : (
                      <>
                        <div className="text-primary font-bold font-mono">+{mission.reward_tokens} {t('economy.wallet.tokens')}</div>
                        <div className="text-secondary font-bold font-mono">+{mission.reward_rep} {t('economy.wallet.rep')}</div>
                      </>
                    )}
                  </div>
                </div>

                {/* Submissions List */}
                {missionSubmissions.length > 0 && (
                  <div className="mb-4 bg-background/50 rounded p-3">
                    <h4 className="text-xs font-bold text-text-secondary uppercase mb-2">{t('economy.missions.your_submissions')}</h4>
                    <div className="space-y-2">
                      {missionSubmissions.map(sub => (
                        <div key={sub.id} className="flex items-center justify-between text-sm border-b border-white/5 pb-2 last:border-0 last:pb-0">
                          <div className="flex items-center space-x-2">
                            {sub.status === 'APPROVED' && <CheckCircle size={14} className="text-green-500" />}
                            {sub.status === 'PENDING' && <Clock size={14} className="text-yellow-500" />}
                            {sub.status === 'REJECTED' && <XCircle size={14} className="text-red-500" />}
                            <span className={
                              sub.status === 'APPROVED' ? 'text-green-500' : 
                              sub.status === 'REJECTED' ? 'text-red-500' : 'text-yellow-500'
                            }>
                              {sub.status === 'APPROVED' ? t('economy.missions.status.approved') : 
                               sub.status === 'REJECTED' ? t('economy.missions.status.rejected') : 
                               t('economy.missions.status.pending')}
                            </span>
                          </div>
                          {sub.status === 'APPROVED' && (
                            <div className="font-mono text-primary">
                              +{sub.payout_tokens ?? 0} {t('economy.wallet.tokens')} / +{sub.payout_rep ?? 0} {t('economy.wallet.rep')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {user ? (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    {isExpired(mission.deadline) ? (
                        <div className="text-center text-red-400 py-2 font-mono text-sm border border-red-500/20 bg-red-500/5 rounded">
                            Mission Expired
                        </div>
                    ) : (
                        <>
                            <textarea
                              placeholder={t('economy.missions.submit_placeholder')}
                              className="w-full bg-background border border-white/10 rounded p-3 text-white mb-3 focus:border-primary outline-none text-sm"
                              rows={3}
                              value={feedback}
                              onChange={(e) => setFeedback(e.target.value)}
                            />
                            <button
                              onClick={() => handleSubmit(mission.id)}
                              disabled={submitting === mission.id || !feedback.trim()}
                              className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/50 px-4 py-2 rounded font-mono text-sm transition-colors disabled:opacity-50"
                            >
                              {submitting === mission.id ? t('economy.missions.submitting') : t('economy.missions.submit_btn')}
                            </button>
                        </>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 text-center">
                    <p className="text-text-secondary text-sm">{t('economy.missions.login_to_submit')}</p>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Create Mission Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface border border-white/20 rounded-lg p-6 max-w-md w-full"
            >
              <h3 className="text-xl font-bold text-white mb-4">{t('economy.missions.create_modal.title')}</h3>
              <div className="space-y-4 mb-4">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">{t('economy.missions.create_modal.name_label')}</label>
                  <input
                    type="text"
                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                    value={newMissionTitle}
                    onChange={(e) => setNewMissionTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">{t('economy.missions.create_modal.desc_label')}</label>
                  <textarea
                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                    rows={3}
                    value={newMissionDesc}
                    onChange={(e) => setNewMissionDesc(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">{t('economy.missions.create_modal.min_label')}</label>
                    <input
                      type="number"
                      className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                      value={newRewardMin}
                      onChange={(e) => setNewRewardMin(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">{t('economy.missions.create_modal.max_label')}</label>
                    <input
                      type="number"
                      className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                      value={newRewardMax}
                      onChange={(e) => setNewRewardMax(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-white/10 text-white py-2 rounded hover:bg-white/20"
                >
                  {t('economy.missions.create_modal.cancel')}
                </button>
                <button
                  onClick={handleCreateMission}
                  disabled={creating}
                  className="flex-1 bg-primary text-background font-bold py-2 rounded hover:bg-primary/90"
                >
                  {creating ? t('economy.missions.create_modal.launching') : t('economy.missions.create_modal.submit')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Missions;
