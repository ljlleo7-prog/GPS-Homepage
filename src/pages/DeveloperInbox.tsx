import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Shield, CheckCircle, XCircle, MessageSquare, Trophy, AlertTriangle, ExternalLink, Gamepad2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useEconomy } from '../context/EconomyContext';
import { useNavigate } from 'react-router-dom';

interface InboxData {
  pending_devs: PendingDev[];
  pending_missions: PendingMission[];
  active_bets: ActiveBet[];
  pending_acks: PendingAck[];
  pending_tests: PendingTest[];
}

interface Mission {
    id: string;
    title: string;
    description: string;
    reward_min: number;
    reward_max: number;
    reward_rep_min: number;
    reward_rep_max: number;
    deadline: string | null;
    status: string;
    submission_count?: number; // Optional, to check if we can edit
}

interface PendingDev {
  id: string;
  username: string;
  full_name: string;
  created_at: string;
}

interface PendingMission {
  id: string;
  content: string;
  created_at: string;
  mission_title: string;
  submitter_name: string;
  user_id: string;
}

interface ActiveBet {
  id: string;
  title: string;
  description: string;
  official_end_date: string;
  side_a_name: string;
  side_b_name: string;
  creator_name?: string;
}

interface PendingAck {
  id: string;
  title: string;
  created_at: string;
  author_name: string;
}

interface PendingTest {
  id: string;
  identifiable_name: string;
  program: string;
  progress_description: string;
  created_at: string;
  user_name: string;
  user_email: string;
}

const DeveloperInbox = () => {
  const { t, i18n } = useTranslation();
  const { developerStatus, approveDeveloperAccess, resolveDriverBet, approveTestPlayerRequest, declineTestPlayerRequest } = useEconomy();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  
  // Mission Management State
  const [missions, setMissions] = useState<Mission[]>([]);
  const [showMissionModal, setShowMissionModal] = useState(false);
  const [editingMissionId, setEditingMissionId] = useState<string | null>(null);
  const [missionForm, setMissionForm] = useState({
      title: '', description: '', 
      minToken: 0, maxToken: 0, 
      minRep: 0, maxRep: 0, 
      deadline: ''
  });

  // Award Modal State
  const [showAwardModal, setShowAwardModal] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<PendingMission | null>(null);
  const [selectedMissionDetails, setSelectedMissionDetails] = useState<Mission | null>(null);
  const [awardForm, setAwardForm] = useState({ tokens: 0, rep: 0 });

  const [data, setData] = useState<InboxData>({
    pending_devs: [],
    pending_missions: [],
    active_bets: [],
    pending_acks: [],
    pending_tests: []
  });

  useEffect(() => {
    if (developerStatus === 'APPROVED') {
      fetchInbox();
    }
  }, [developerStatus]);

  const fetchInbox = async () => {
    setLoading(true);
    try {
      console.log('Fetching developer inbox...');
      const { data: result, error } = await supabase.rpc('get_developer_inbox');
      if (error) throw error;
      console.log('Inbox result:', result);
      if (result && result.success) {
        setData({
          pending_devs: result.pending_devs,
          pending_missions: result.pending_missions,
          active_bets: result.active_bets,
          pending_acks: result.pending_acks,
          pending_tests: result.pending_tests || []
        });
      }
    } catch (error) {
      console.error('Error fetching inbox:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMissions = async () => {
      const { data, error } = await supabase
          .from('missions')
          .select('*')
          .neq('status', 'ARCHIVED')
          .order('created_at', { ascending: false });
      
      if (data) {
          // Check for pending submissions for each mission to control editability
          // This is a bit N+1, but for a dev tool it's acceptable. 
          // Better: use a view, but let's do simple counts.
          const missionsWithCounts = await Promise.all(data.map(async (m) => {
              const { count } = await supabase
                  .from('mission_submissions')
                  .select('*', { count: 'exact', head: true })
                  .eq('mission_id', m.id)
                  .eq('status', 'PENDING');
              return { ...m, submission_count: count || 0 };
          }));
          setMissions(missionsWithCounts);
      }
  };

  useEffect(() => {
      fetchMissions();
  }, []);

  const handleSaveMission = async () => {
      try {
          const payload = {
              title: missionForm.title,
              description: missionForm.description,
              reward_min: missionForm.minToken,
              reward_max: missionForm.maxToken,
              reward_rep_min: missionForm.minRep,
              reward_rep_max: missionForm.maxRep,
              deadline: missionForm.deadline || null,
              is_variable_reward: true, // Always true for this new system
              creator_id: (await supabase.auth.getUser()).data.user?.id
          };

          if (editingMissionId) {
              const { error } = await supabase
                  .from('missions')
                  .update(payload)
                  .eq('id', editingMissionId);
              if (error) throw error;
          } else {
              const { error } = await supabase.from('missions').insert(payload);
              if (error) throw error;
          }

          setShowMissionModal(false);
          setEditingMissionId(null);
          setMissionForm({ title: '', description: '', minToken: 0, maxToken: 0, minRep: 0, maxRep: 0, deadline: '' });
          fetchMissions();
      } catch (error: any) {
          alert('Error saving mission: ' + error.message);
      }
  };

  const handleDeleteMission = async (id: string) => {
      if (!confirm('Are you sure you want to delete this mission?')) return;
      try {
          const { error } = await supabase.from('missions').delete().eq('id', id);
          if (error) throw error;
          fetchMissions();
      } catch (error: any) {
          alert('Error deleting mission: ' + error.message);
      }
  };

  const openEditMission = (mission: Mission) => {
      if (mission.submission_count && mission.submission_count > 0) {
          alert('Cannot edit mission with pending submissions.');
          return;
      }
      setMissionForm({
          title: mission.title,
          description: mission.description,
          minToken: mission.reward_min || 0,
          maxToken: mission.reward_max || 0,
          minRep: mission.reward_rep_min || 0,
          maxRep: mission.reward_rep_max || 0,
          deadline: mission.deadline ? new Date(mission.deadline).toISOString().split('T')[0] : ''
      });
      setEditingMissionId(mission.id);
      setShowMissionModal(true);
  };

  const handlePrepareAward = async (submissionId: string) => {
      try {
          // Get submission to find mission_id
          const { data: sub, error: subError } = await supabase
              .from('mission_submissions')
              .select('*, mission:missions(*)')
              .eq('id', submissionId)
              .single();
          
          if (subError) throw subError;
          
          // Find the submission in our local state to pass UI details
          const localSub = data.pending_missions.find(p => p.id === submissionId);
          
          setSelectedSubmission(localSub || null);
          setSelectedMissionDetails(sub.mission);
          setAwardForm({ tokens: sub.mission.reward_min || 0, rep: sub.mission.reward_rep_min || 0 });
          setShowAwardModal(true);
      } catch (error: any) {
          alert('Error preparing award: ' + error.message);
      }
  };

  const handleSubmitAward = async () => {
      if (!selectedSubmission || !selectedMissionDetails) return;
      
      // Validate
      if (awardForm.tokens < (selectedMissionDetails.reward_min || 0) || awardForm.tokens > (selectedMissionDetails.reward_max || 0)) {
          alert(`Tokens must be between ${selectedMissionDetails.reward_min} and ${selectedMissionDetails.reward_max}`);
          return;
      }
      if (awardForm.rep < (selectedMissionDetails.reward_rep_min || 0) || awardForm.rep > (selectedMissionDetails.reward_rep_max || 0)) {
          alert(`Reputation must be between ${selectedMissionDetails.reward_rep_min} and ${selectedMissionDetails.reward_rep_max}`);
          return;
      }

      try {
          const { error } = await supabase
              .from('mission_submissions')
              .update({
                  status: 'APPROVED',
                  payout_tokens: awardForm.tokens,
                  payout_rep: awardForm.rep
              })
              .eq('id', selectedSubmission.id);

          if (error) throw error;
          
          setShowAwardModal(false);
          fetchInbox(); // Refresh inbox
      } catch (error: any) {
          alert('Error awarding submission: ' + error.message);
      }
  };

  const handleApproveDev = async (id: string) => {
    if (!confirm('Approve this user as developer?')) return;
    const result = await approveDeveloperAccess(id);
    if (result.success) {
      fetchInbox();
    } else {
      alert(result.message || 'Failed to approve');
    }
  };

  const handleDeclineDev = async (id: string) => {
    if (!confirm('Decline this developer request?')) return;
    try {
        const { data, error } = await supabase.rpc('decline_developer_access', {
            target_user_id: id
        });
        
        if (error) throw error;
        if (data && !data.success) throw new Error(data.message);
        
        fetchInbox();
    } catch (error: any) {
        alert(error.message || 'Failed to decline');
    }
  };

  const handleApproveMission = async (id: string) => {
    if (!confirm('Approve this mission submission?')) return;
    try {
        // Assuming mission_submissions table has a status column
        // We might need to trigger payout too. The trigger 'process_mission_payout' handles it on update.
        const { error } = await supabase
            .from('mission_submissions')
            .update({ status: 'APPROVED' })
            .eq('id', id);

        if (error) throw error;
        fetchInbox();
    } catch (error: any) {
        alert(error.message || 'Failed to approve mission');
    }
  };

  const handleRejectMission = async (id: string) => {
    if (!confirm('Reject this mission submission?')) return;
    try {
        const { error } = await supabase
            .from('mission_submissions')
            .update({ status: 'REJECTED' })
            .eq('id', id);

        if (error) throw error;
        fetchInbox();
    } catch (error: any) {
        alert(error.message || 'Failed to reject mission');
    }
  };

  const handleResolveBetAction = async (id: string, side: 'A' | 'B') => {
      const proofUrl = prompt('Enter proof URL (optional):', 'https://example.com');
      if (proofUrl === null) return; // Cancelled

      const result = await resolveDriverBet(id, side, proofUrl);
      if (result.success) {
          fetchInbox();
      } else {
          alert(result.message);
      }
  };

  const handleAcknowledgePost = async (id: string) => {
      if (!confirm('Mark this post as acknowledged?')) return;
      try {
          const { error } = await supabase
            .from('forum_posts')
            .update({ is_acknowledgement_requested: false })
            .eq('id', id);
          
          if (error) throw error;
          fetchInbox();
      } catch (error: any) {
          alert(error.message || 'Failed to acknowledge');
      }
  };

  const handleApproveTest = async (id: string) => {
    if (!confirm('Approve this test player? They will receive +20 Rep.')) return;
    const result = await approveTestPlayerRequest(id);
    if (result.success) {
      fetchInbox();
    } else {
      alert(result.message || 'Failed to approve');
    }
  };

  const handleDeclineTest = async (id: string) => {
    if (!confirm('Decline this request?')) return;
    const result = await declineTestPlayerRequest(id);
    if (result.success) {
      fetchInbox();
    } else {
      alert(result.message || 'Failed to decline');
    }
  };

  if (developerStatus !== 'APPROVED') {
      return (
          <div className="min-h-screen bg-background pt-24 text-center text-white">
              <div className="max-w-md mx-auto p-6 bg-surface border border-red-500/30 rounded-lg">
                  <Shield size={48} className="mx-auto text-red-500 mb-4" />
                  <h2 className="text-xl font-bold mb-2">{t('developer_inbox.access_denied')}</h2>
                  <p className="text-text-secondary">{t('developer_inbox.must_be_developer')}</p>
              </div>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-background pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-8"
        >
          <h1 className="text-3xl font-bold font-mono text-white flex items-center gap-3">
            <Shield className="text-cyan-400" />
            {t('developer_inbox.title')}
          </h1>
          <button 
            onClick={fetchInbox}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded hover:bg-white/10 text-sm font-mono text-text-secondary"
          >
            {t('developer_inbox.refresh')}
          </button>
        </motion.div>

        {loading ? (
             <div className="text-center text-text-secondary py-12">{t('developer_inbox.loading')}</div>
        ) : (
            <div className="space-y-8">
                {/* 0. Mission Management */}
                <Section title="Mission Control" icon={<Trophy className="text-yellow-400" />} count={missions.length}>
                    <div className="mb-4">
                        <button 
                            onClick={() => {
                                setMissionForm({ title: '', description: '', minToken: 0, maxToken: 0, minRep: 0, maxRep: 0, deadline: '' });
                                setEditingMissionId(null);
                                setShowMissionModal(true);
                            }} 
                            className="bg-primary hover:bg-primary/80 text-black px-4 py-2 rounded font-bold text-sm transition-colors flex items-center gap-2"
                        >
                            <Trophy size={16} />
                            Create New Mission
                        </button>
                    </div>
                    {missions.length === 0 ? (
                        <div className="text-text-secondary text-sm italic">No active missions.</div>
                    ) : (
                        <div className="grid gap-4">
                            {missions.map(m => (
                                <Card key={m.id}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="font-bold text-white text-lg">{m.title}</h3>
                                            <p className="text-sm text-text-secondary mb-2">{m.description}</p>
                                            <div className="flex flex-wrap gap-3 text-xs font-mono">
                                                <span className="bg-yellow-500/10 text-yellow-400 px-2 py-1 rounded border border-yellow-500/20">
                                                    Tokens: {m.reward_min}-{m.reward_max}
                                                </span>
                                                <span className="bg-purple-500/10 text-purple-400 px-2 py-1 rounded border border-purple-500/20">
                                                    Rep: {m.reward_rep_min}-{m.reward_rep_max}
                                                </span>
                                                {m.deadline && (
                                                    <span className="bg-red-500/10 text-red-400 px-2 py-1 rounded border border-red-500/20">
                                                        Due: {new Date(m.deadline).toLocaleDateString()}
                                                    </span>
                                                )}
                                            </div>
                                            {m.submission_count !== undefined && m.submission_count > 0 && (
                                                <div className="text-xs text-blue-400 mt-2">
                                                    {m.submission_count} pending submissions (Cannot Edit)
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => openEditMission(m)}
                                                disabled={m.submission_count !== undefined && m.submission_count > 0}
                                                className="px-3 py-1 bg-white/5 hover:bg-white/10 text-white text-xs rounded border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Edit
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteMission(m.id)}
                                                className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded border border-red-500/20"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 1. Pending Developer Requests */}
                <Section title={t('developer_inbox.pending_dev_requests')} icon={<UserIcon />} count={data.pending_devs.length}>
                    {data.pending_devs.length === 0 ? (
                        <EmptyState message={t('developer_inbox.no_pending_dev_requests')} />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_devs.map(dev => (
                                <Card key={dev.id}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="font-bold text-white text-lg">{dev.username}</h3>
                                            <p className="text-sm text-text-secondary">{t('developer_inbox.full_name')}: {dev.full_name}</p>
                                            <p className="text-xs text-text-secondary mt-1">{t('developer_inbox.requested')}: {new Date(dev.created_at).toLocaleDateString(i18n.language)}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <ActionButton 
                                                onClick={() => handleApproveDev(dev.id)} 
                                                variant="approve"
                                                label={t('common.approve')}
                                            />
                                            <ActionButton 
                                                onClick={() => handleDeclineDev(dev.id)} 
                                                variant="reject"
                                                label={t('common.decline')}
                                            />
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 2. Pending Mission Submissions */}
                <Section title={t('developer_inbox.pending_mission_submissions')} icon={<TrophyIcon />} count={data.pending_missions.length}>
                    {data.pending_missions.length === 0 ? (
                        <EmptyState message={t('developer_inbox.no_pending_mission_submissions')} />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_missions.map(sub => (
                                <Card key={sub.id}>
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 mr-4">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-primary/20 text-primary text-xs px-2 py-0.5 rounded border border-primary/30 font-mono">
                                                    {t('developer_inbox.mission_tag')}
                                                </span>
                                                <h3 className="font-bold text-white">{sub.mission_title}</h3>
                                            </div>
                                            <p className="text-sm text-text-secondary mb-2">{t('common.by')} <span className="text-white">{sub.submitter_name}</span></p>
                                            <div className="bg-black/30 p-3 rounded border border-white/5 text-sm font-mono text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                                {sub.content}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <ActionButton 
                                                onClick={() => handlePrepareAward(sub.id)} 
                                                variant="approve"
                                                label={t('common.approve')}
                                            />
                                            <ActionButton 
                                                onClick={() => handleRejectMission(sub.id)} 
                                                variant="reject"
                                                label={t('common.reject')}
                                            />
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 3. Active Driver Bets (Resolution Needed) */}
                <Section title={t('developer_inbox.active_driver_bets')} icon={<AlertTriangleIcon />} count={data.active_bets.length}>
                     {data.active_bets.length === 0 ? (
                        <EmptyState message={t('developer_inbox.no_active_bets')} />
                    ) : (
                        <div className="grid gap-4">
                            {data.active_bets.map(bet => (
                                <Card key={bet.id}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-secondary/20 text-secondary text-xs px-2 py-0.5 rounded border border-secondary/30 font-mono">
                                                    {t('developer_inbox.driver_bet_tag')}
                                            </span>
                                            <h3 className="font-bold text-white">{bet.title}</h3>
                                        </div>
                                        <p className="text-sm text-text-secondary mb-2">{t('common.by')} <span className="text-white">{bet.creator_name || t('common.unknown')}</span></p>
                                        <p className="text-sm text-text-secondary mb-2">{bet.description}</p>
                                        <p className="text-xs text-text-secondary">{t('developer_inbox.end_date')}: {new Date(bet.official_end_date).toLocaleDateString(i18n.language)}</p>
                                    </div>
                                        <div className="flex flex-col gap-2 min-w-[140px]">
                                            <span className="text-xs text-center text-text-secondary mb-1">{t('developer_inbox.declare_winner')}:</span>
                                            <button 
                                                onClick={() => handleResolveBetAction(bet.id, 'A')}
                                                className="px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 rounded hover:bg-green-500/20 text-xs font-mono"
                                            >
                                                {t('developer_inbox.side_a')}: {bet.side_a_name}
                                            </button>
                                            <button 
                                                onClick={() => handleResolveBetAction(bet.id, 'B')}
                                                className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded hover:bg-red-500/20 text-xs font-mono"
                                            >
                                                {t('developer_inbox.side_b')}: {bet.side_b_name}
                                            </button>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 4. Forum Acknowledgements */}
                <Section title={t('developer_inbox.forum_acknowledgements')} icon={<MessageSquareIcon />} count={data.pending_acks.length}>
                    {data.pending_acks.length === 0 ? (
                        <EmptyState message={t('developer_inbox.no_pending_acknowledgements')} />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_acks.map(ack => (
                                <Card key={ack.id}>
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-bold text-white text-lg mb-1">{ack.title}</h3>
                                            <p className="text-sm text-text-secondary">
                                                {t('developer_inbox.request_by')} <span className="text-white">{ack.author_name}</span> • {new Date(ack.created_at).toLocaleDateString(i18n.language)}
                                            </p>
                                            <a href={`/community?post=${ack.id}`} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline flex items-center gap-1 mt-2">
                                                {t('developer_inbox.view_post')} <ExternalLink size={12} />
                                            </a>
                                        </div>
                                        <ActionButton 
                                            onClick={() => handleAcknowledgePost(ack.id)} 
                                            variant="neutral"
                                            label={t('developer_inbox.acknowledge')}
                                        />
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>
                {/* 5. Pending Test Player Requests */}
                <Section title={t('developer_inbox.test_player_requests')} icon={<Gamepad2 size={20} className="text-blue-400" />} count={data.pending_tests.length}>
                    {data.pending_tests.length === 0 ? (
                        <EmptyState message={t('developer_inbox.no_pending_test_player_requests')} />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_tests.map(req => (
                                <Card key={req.id}>
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 mr-4">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-blue-500/20 text-blue-400 text-xs px-2 py-0.5 rounded border border-blue-500/30 font-mono">
                                                    {t('developer_inbox.tester_tag')}
                                                </span>
                                                <h3 className="font-bold text-white">{req.program}</h3>
                                            </div>
                                            <p className="text-sm text-text-secondary mb-1">
                                              {t('developer_inbox.user')}: <span className="text-white">{req.user_name}</span> ({req.identifiable_name})
                                            </p>
                                            <p className="text-xs text-text-secondary mb-3">
                                              {t('developer_inbox.email')}: {req.user_email} • {new Date(req.created_at).toLocaleDateString(i18n.language)}
                                            </p>
                                            <div className="bg-black/30 p-3 rounded border border-white/5 text-sm text-gray-300">
                                                {req.progress_description}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <ActionButton 
                                                onClick={() => handleApproveTest(req.id)} 
                                                variant="approve"
                                                label={t('common.approve')}
                                            />
                                            <ActionButton 
                                                onClick={() => handleDeclineTest(req.id)} 
                                                variant="reject"
                                                label={t('common.decline')}
                                            />
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>
            </div>
        )}

        {/* Modals */}
        {showMissionModal && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-surface border border-white/10 rounded-lg p-6 max-w-lg w-full shadow-2xl"
                >
                    <h2 className="text-xl font-bold text-white mb-4">
                        {editingMissionId ? 'Edit Mission' : 'Create New Mission'}
                    </h2>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">Title</label>
                            <input 
                                type="text" 
                                value={missionForm.title}
                                onChange={e => setMissionForm({...missionForm, title: e.target.value})}
                                className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">Description</label>
                            <textarea 
                                value={missionForm.description}
                                onChange={e => setMissionForm({...missionForm, description: e.target.value})}
                                className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none h-24"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-text-secondary mb-1">Min Tokens</label>
                                <input 
                                    type="number" 
                                    value={missionForm.minToken}
                                    onChange={e => setMissionForm({...missionForm, minToken: parseInt(e.target.value) || 0})}
                                    className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-text-secondary mb-1">Max Tokens</label>
                                <input 
                                    type="number" 
                                    value={missionForm.maxToken}
                                    onChange={e => setMissionForm({...missionForm, maxToken: parseInt(e.target.value) || 0})}
                                    className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-text-secondary mb-1">Min Rep</label>
                                <input 
                                    type="number" 
                                    value={missionForm.minRep}
                                    onChange={e => setMissionForm({...missionForm, minRep: parseInt(e.target.value) || 0})}
                                    className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-text-secondary mb-1">Max Rep</label>
                                <input 
                                    type="number" 
                                    value={missionForm.maxRep}
                                    onChange={e => setMissionForm({...missionForm, maxRep: parseInt(e.target.value) || 0})}
                                    className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">Deadline (Optional)</label>
                            <input 
                                type="date" 
                                value={missionForm.deadline}
                                onChange={e => setMissionForm({...missionForm, deadline: e.target.value})}
                                className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                            />
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <button 
                                onClick={() => setShowMissionModal(false)}
                                className="px-4 py-2 text-text-secondary hover:text-white"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleSaveMission}
                                className="px-4 py-2 bg-primary text-black font-bold rounded hover:bg-primary/80"
                            >
                                Save Mission
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>
        )}

        {showAwardModal && selectedSubmission && selectedMissionDetails && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="bg-surface border border-white/10 rounded-lg p-6 max-w-md w-full shadow-2xl"
                >
                    <h2 className="text-xl font-bold text-white mb-4">Award Submission</h2>
                    <div className="mb-4 p-3 bg-black/30 rounded border border-white/5 text-sm text-gray-300 max-h-32 overflow-y-auto">
                        {selectedSubmission.content}
                    </div>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">
                                Award Tokens ({selectedMissionDetails.reward_min} - {selectedMissionDetails.reward_max})
                            </label>
                            <input 
                                type="number" 
                                value={awardForm.tokens}
                                onChange={e => setAwardForm({...awardForm, tokens: parseInt(e.target.value) || 0})}
                                className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">
                                Award Reputation ({selectedMissionDetails.reward_rep_min} - {selectedMissionDetails.reward_rep_max})
                            </label>
                            <input 
                                type="number" 
                                value={awardForm.rep}
                                onChange={e => setAwardForm({...awardForm, rep: parseInt(e.target.value) || 0})}
                                className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                            />
                        </div>
                        
                        <div className="flex justify-end gap-2 mt-6">
                            <button 
                                onClick={() => setShowAwardModal(false)}
                                className="px-4 py-2 text-text-secondary hover:text-white"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleSubmitAward}
                                className="px-4 py-2 bg-green-500 text-black font-bold rounded hover:bg-green-400"
                            >
                                Approve & Award
                            </button>
                        </div>
                    </div>
                </motion.div>
            </div>
        )}
      </div>
    </div>
  );
};

const Section = ({ title, icon, count, children }: { title: string, icon: React.ReactNode, count: number, children: React.ReactNode }) => (
    <div className="bg-surface border border-white/10 rounded-lg overflow-hidden">
        <div className="bg-white/5 px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                {icon}
                {title}
            </h2>
            {count > 0 && (
                <span className="bg-primary text-background text-xs font-bold px-2 py-1 rounded-full min-w-[24px] text-center">
                    {count}
                </span>
            )}
        </div>
        <div className="p-6">
            {children}
        </div>
    </div>
);

const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="bg-background border border-white/10 rounded p-4 hover:border-white/20 transition-colors">
        {children}
    </div>
);

const EmptyState = ({ message }: { message: string }) => (
    <div className="text-center text-text-secondary py-8 italic opacity-70">
        {message}
    </div>
);

const ActionButton = ({ onClick, variant, label }: { onClick: () => void, variant: 'approve' | 'reject' | 'neutral', label: string }) => {
    const styles = {
        approve: "bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20",
        reject: "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20",
        neutral: "bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20"
    };
    
    const icons = {
        approve: <CheckCircle size={16} />,
        reject: <XCircle size={16} />,
        neutral: <CheckCircle size={16} />
    };

    return (
        <button 
            onClick={onClick}
            className={`flex items-center gap-2 px-4 py-2 border rounded transition-all font-mono text-sm ${styles[variant]}`}
        >
            {icons[variant]}
            {label}
        </button>
    );
};

const UserIcon = () => <Shield size={20} className="text-cyan-400" />;
const TrophyIcon = () => <Trophy size={20} className="text-yellow-400" />;
const AlertTriangleIcon = () => <AlertTriangle size={20} className="text-orange-400" />;
const MessageSquareIcon = () => <MessageSquare size={20} className="text-purple-400" />;

export default DeveloperInbox;
