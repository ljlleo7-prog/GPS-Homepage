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
      
      if (error) {
        console.error('RPC Error:', error);
        alert(`Error fetching inbox: ${error.message}`);
        throw error;
      }
      
      console.log('Inbox result:', result);
      
      if (result) {
        if (result.success) {
          setData({
            pending_devs: result.pending_devs,
            pending_missions: result.pending_missions,
            active_bets: result.active_bets,
            pending_acks: result.pending_acks,
            pending_tests: result.pending_tests || []
          });
        } else {
          console.error('Inbox fetch failed logically:', result.message);
          // Show alert for logical failures (e.g. Unauthorized or RPC internal error)
          if (result.message) {
             alert(`Inbox Error: ${result.message}`);
          }
        }
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
          alert(t('developer.inbox.mission_control.error_save', { error: error.message }));
      }
  };

  const handleDeleteMission = async (id: string) => {
      if (!confirm(t('developer.inbox.mission_control.confirm_delete'))) return;
      try {
          const { error } = await supabase.from('missions').delete().eq('id', id);
          if (error) throw error;
          fetchMissions();
      } catch (error: any) {
          alert(t('developer.inbox.mission_control.error_delete', { error: error.message }));
      }
  };

  const openEditMission = (mission: Mission) => {
      if (mission.submission_count && mission.submission_count > 0) {
          alert(t('developer.inbox.mission_control.error_edit_pending'));
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
          alert(t('developer.inbox.mission_control.error_prepare_award', { error: error.message }));
      }
  };

  const handleSubmitAward = async () => {
      if (!selectedSubmission || !selectedMissionDetails) return;
      
      // Validate
      if (awardForm.tokens < (selectedMissionDetails.reward_min || 0) || awardForm.tokens > (selectedMissionDetails.reward_max || 0)) {
          alert(t('developer.inbox.mission_control.error_tokens_range', { min: selectedMissionDetails.reward_min, max: selectedMissionDetails.reward_max }));
          return;
      }
      if (awardForm.rep < (selectedMissionDetails.reward_rep_min || 0) || awardForm.rep > (selectedMissionDetails.reward_rep_max || 0)) {
          alert(t('developer.inbox.mission_control.error_rep_range', { min: selectedMissionDetails.reward_rep_min, max: selectedMissionDetails.reward_rep_max }));
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
          alert(t('developer.inbox.mission_control.error_award', { error: error.message }));
      }
  };

  const handleApproveDev = async (id: string) => {
    if (!confirm(t('developer.inbox.confirms.approve_dev'))) return;
    const result = await approveDeveloperAccess(id);
    if (result.success) {
      fetchInbox();
    } else {
      alert(result.message || t('developer.inbox.alerts.approve_failed'));
    }
  };

  const handleDeclineDev = async (id: string) => {
    if (!confirm(t('developer.inbox.confirms.decline_dev'))) return;
    try {
        const { data, error } = await supabase.rpc('decline_developer_access', {
            target_user_id: id
        });
        
        if (error) throw error;
        if (data && !data.success) throw new Error(data.message);
        
        fetchInbox();
    } catch (error: any) {
        alert(error.message || t('developer.inbox.alerts.decline_failed'));
    }
  };

  const handleApproveMission = async (id: string) => {
    if (!confirm(t('developer.inbox.confirms.approve_mission'))) return;
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
        alert(error.message || t('developer.inbox.alerts.approve_mission_failed'));
    }
  };

  const handleRejectMission = async (id: string) => {
    if (!confirm(t('developer.inbox.confirms.reject_mission'))) return;
    try {
        const { error } = await supabase
            .from('mission_submissions')
            .update({ status: 'REJECTED' })
            .eq('id', id);

        if (error) throw error;
        fetchInbox();
    } catch (error: any) {
        alert(error.message || t('developer.inbox.alerts.reject_mission_failed'));
    }
  };

  const handleResolveBetAction = async (id: string, side: 'A' | 'B') => {
      const proofUrl = prompt(t('developer.inbox.prompts.proof_url'), 'https://example.com');
      if (proofUrl === null) return; // Cancelled

      const result = await resolveDriverBet(id, side, proofUrl);
      if (result.success) {
          fetchInbox();
      } else {
          alert(result.message);
      }
  };

  const handleAcknowledgePost = async (id: string) => {
      if (!confirm(t('developer.inbox.confirms.acknowledge_post'))) return;
      try {
          const { error } = await supabase
            .from('forum_posts')
            .update({ is_acknowledgement_requested: false })
            .eq('id', id);
          
          if (error) throw error;
          fetchInbox();
      } catch (error: any) {
          alert(error.message || t('developer.inbox.alerts.acknowledge_failed'));
      }
  };

  const handleApproveTest = async (id: string) => {
    if (!confirm(t('developer.inbox.confirms.approve_test'))) return;
    const result = await approveTestPlayerRequest(id);
    if (result.success) {
      fetchInbox();
    } else {
      alert(result.message || t('developer.inbox.alerts.approve_failed'));
    }
  };

  const handleDeclineTest = async (id: string) => {
    if (!confirm(t('developer.inbox.confirms.decline_test'))) return;
    const result = await declineTestPlayerRequest(id);
    if (result.success) {
      fetchInbox();
    } else {
      alert(result.message || t('developer.inbox.alerts.decline_failed'));
    }
  };

  if (developerStatus !== 'APPROVED') {
      return (
          <div className="min-h-screen bg-background pt-24 text-center text-white">
              <div className="max-w-md mx-auto p-6 bg-surface border border-red-500/30 rounded-lg">
                  <Shield size={48} className="mx-auto text-red-500 mb-4" />
                  <h2 className="text-xl font-bold mb-2">{t('developer.inbox.access_denied')}</h2>
                  <p className="text-text-secondary">{t('developer.inbox.access_denied_desc')}</p>
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
            {t('developer.inbox.title')}
          </h1>
          <button 
            onClick={fetchInbox}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded hover:bg-white/10 text-sm font-mono text-text-secondary"
          >
            {t('developer.inbox.refresh')}
          </button>
        </motion.div>

        {loading ? (
             <div className="text-center text-text-secondary py-12">{t('developer.inbox.loading')}</div>
        ) : (
            <div className="space-y-8">
                {/* 0. Mission Management */}
                <Section title={t('developer.inbox.mission_control.title')} icon={<Trophy className="text-yellow-400" />} count={missions.length}>
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
                            {t('developer.inbox.mission_control.create_btn')}
                        </button>
                    </div>
                    {missions.length === 0 ? (
                        <div className="text-text-secondary text-sm italic">{t('developer.inbox.mission_control.no_active')}</div>
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
                                                    {t('developer.inbox.mission_control.tokens')}: {m.reward_min}-{m.reward_max}
                                                </span>
                                                <span className="bg-purple-500/10 text-purple-400 px-2 py-1 rounded border border-purple-500/20">
                                                    {t('developer.inbox.mission_control.rep')}: {m.reward_rep_min}-{m.reward_rep_max}
                                                </span>
                                                {m.deadline && (
                                                    <span className="bg-red-500/10 text-red-400 px-2 py-1 rounded border border-red-500/20">
                                                        {t('developer.inbox.mission_control.due')}: {new Date(m.deadline).toLocaleDateString()}
                                                    </span>
                                                )}
                                            </div>
                                            {m.submission_count !== undefined && m.submission_count > 0 && (
                                                <div className="text-xs text-blue-400 mt-2">
                                                    {t('developer.inbox.mission_control.pending_submissions', { count: m.submission_count })}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => openEditMission(m)}
                                                disabled={m.submission_count !== undefined && m.submission_count > 0}
                                                className="px-3 py-1 bg-white/5 hover:bg-white/10 text-white text-xs rounded border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {t('developer.inbox.mission_control.edit')}
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteMission(m.id)}
                                                className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded border border-red-500/20"
                                            >
                                                {t('developer.inbox.mission_control.delete')}
                                            </button>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 1. Pending Developer Requests */}
                <Section title={t('developer.inbox.sections.dev_requests')} icon={<UserIcon />} count={data.pending_devs.length}>
          {data.pending_devs.length === 0 ? (
            <EmptyState message={t('developer.inbox.empty.dev_requests')} />
          ) : (
            <div className="grid gap-4">
              {data.pending_devs.map(dev => (
                <Card key={dev.id}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-white text-lg">{dev.username}</h3>
                      <p className="text-sm text-text-secondary">{t('developer.inbox.full_name')}: {dev.full_name}</p>
                      <p className="text-xs text-text-secondary mt-1">{t('developer.inbox.requested')}: {new Date(dev.created_at).toLocaleDateString(i18n.language)}</p>
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
                <Section title={t('developer.inbox.sections.mission_submissions')} icon={<TrophyIcon />} count={data.pending_missions.length}>
                    {data.pending_missions.length === 0 ? (
                        <EmptyState message={t('developer.inbox.empty.mission_submissions')} />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_missions.map(sub => (
                                <Card key={sub.id}>
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 mr-4">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-primary/20 text-primary text-xs px-2 py-0.5 rounded border border-primary/30 font-mono">
                                                    {t('developer.inbox.actions.mission_tag')}
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
                <Section title={t('developer.inbox.sections.active_bets')} icon={<AlertTriangleIcon />} count={data.active_bets.length}>
                     {data.active_bets.length === 0 ? (
                        <EmptyState message={t('developer.inbox.empty.active_bets')} />
                    ) : (
                        <div className="grid gap-4">
                            {data.active_bets.map(bet => (
                                <Card key={bet.id}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded border border-red-500/30 font-mono">
                                                    {t('developer.inbox.actions.driver_bet_tag')}
                                                </span>
                                                <h3 className="font-bold text-white text-lg">{bet.title}</h3>
                                            </div>
                                            <p className="text-sm text-text-secondary mb-2">{bet.description}</p>
                                            <p className="text-xs text-text-secondary">{t('developer.inbox.end_date')}: {new Date(bet.official_end_date).toLocaleDateString(i18n.language)}</p>
                                            
                                            <div className="mt-3 p-3 bg-black/30 rounded border border-white/5">
                                                <span className="text-xs text-center text-text-secondary mb-1">{t('developer.inbox.declare_winner')}:</span>
                                                <div className="flex gap-2 mt-2">
                                                    <button 
                                                        onClick={() => handleResolveBetAction(bet.id, 'A')}
                                                        className="flex-1 bg-red-900/50 hover:bg-red-800/50 border border-red-700 text-red-200 text-xs py-1 px-2 rounded transition-colors"
                                                    >
                                                        {t('developer.inbox.actions.side_a')}: {bet.side_a_name}
                                                    </button>
                                                    <button 
                                                        onClick={() => handleResolveBetAction(bet.id, 'B')}
                                                        className="flex-1 bg-blue-900/50 hover:bg-blue-800/50 border border-blue-700 text-blue-200 text-xs py-1 px-2 rounded transition-colors"
                                                    >
                                                        {t('developer.inbox.actions.side_b')}: {bet.side_b_name}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 4. Forum Acknowledgements */}
                <Section title={t('developer.inbox.sections.forum_acks')} icon={<MessageSquareIcon />} count={data.pending_acks.length}>
                    {data.pending_acks.length === 0 ? (
                        <EmptyState message={t('developer.inbox.empty.forum_acks')} />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_acks.map(ack => (
                                <Card key={ack.id}>
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-bold text-white text-lg">{ack.title}</h3>
                                            <div className="flex items-center gap-2 text-xs text-text-secondary mt-1">
                                                {t('developer.inbox.actions.by')} <span className="text-white">{ack.author_name}</span> • {new Date(ack.created_at).toLocaleDateString(i18n.language)}
                                                <a 
                                                    href={`/forum/post/${ack.id}`} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1 text-primary hover:underline ml-2"
                                                >
                                                    {t('developer.inbox.actions.view_post')} <ExternalLink size={12} />
                                                </a>
                                            </div>
                                        </div>
                                        <ActionButton 
                                            onClick={() => handleAcknowledgePost(ack.id)} 
                                            variant="approve"
                                            label={t('developer.inbox.actions.acknowledge')}
                                        />
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>
                {/* 5. Pending Test Player Requests */}
                <Section title={t('developer.inbox.sections.test_requests')} icon={<Gamepad2 size={20} className="text-blue-400" />} count={data.pending_tests.length}>
                    {data.pending_tests.length === 0 ? (
                        <EmptyState message={t('developer.inbox.empty.test_requests')} />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_tests.map(req => (
                                <Card key={req.id}>
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 mr-4">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="bg-purple-500/20 text-purple-400 text-xs px-2 py-0.5 rounded border border-purple-500/30 font-mono">
                                                    {t('developer.inbox.actions.tester_tag')}
                                                </span>
                                                <h3 className="font-bold text-white text-lg">{req.program}</h3>
                                            </div>
                                            <div className="mt-2 text-sm text-gray-300 space-y-1">
                                              <p>{t('developer.inbox.labels.user')}: <span className="text-white">{req.user_name}</span> ({req.identifiable_name})</p>
                                              
                                              <p className="mt-2 bg-black/20 p-2 rounded border border-white/5 italic">"{req.progress_description}"</p>
                                              
                                              <p>{t('developer.inbox.labels.email')}: {req.user_email} • {new Date(req.created_at).toLocaleDateString(i18n.language)}</p>
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
                        {editingMissionId ? t('developer.inbox.mission_control.edit_mission') : t('developer.inbox.mission_control.create_mission')}
                    </h2>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">{t('developer.inbox.mission_control.form.title')}</label>
                            <input 
                                type="text" 
                                value={missionForm.title}
                                onChange={e => setMissionForm({...missionForm, title: e.target.value})}
                                className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">{t('developer.inbox.mission_control.form.description')}</label>
                            <textarea 
                                value={missionForm.description}
                                onChange={e => setMissionForm({...missionForm, description: e.target.value})}
                                className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none h-24"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-text-secondary mb-1">{t('developer.inbox.mission_control.form.min_tokens')}</label>
                                <input 
                                    type="number" 
                                    value={missionForm.minToken}
                                    onChange={e => setMissionForm({...missionForm, minToken: parseInt(e.target.value) || 0})}
                                    className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-text-secondary mb-1">{t('developer.inbox.mission_control.form.max_tokens')}</label>
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
                                <label className="block text-xs text-text-secondary mb-1">{t('developer.inbox.mission_control.form.min_rep')}</label>
                                <input 
                                    type="number" 
                                    value={missionForm.minRep}
                                    onChange={e => setMissionForm({...missionForm, minRep: parseInt(e.target.value) || 0})}
                                    className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-text-secondary mb-1">{t('developer.inbox.mission_control.form.max_rep')}</label>
                                <input 
                                    type="number" 
                                    value={missionForm.maxRep}
                                    onChange={e => setMissionForm({...missionForm, maxRep: parseInt(e.target.value) || 0})}
                                    className="w-full bg-black/30 border border-white/10 rounded p-2 text-white focus:border-primary outline-none"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">{t('developer.inbox.mission_control.form.deadline')}</label>
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
                                {t('developer.inbox.mission_control.cancel')}
                            </button>
                            <button 
                                onClick={handleSaveMission}
                                className="px-4 py-2 bg-primary text-black font-bold rounded hover:bg-primary/80"
                            >
                                {t('developer.inbox.mission_control.save_mission')}
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
                    <h2 className="text-xl font-bold text-white mb-4">{t('developer.inbox.mission_control.award_submission_title')}</h2>
                    <div className="mb-4 p-3 bg-black/30 rounded border border-white/5 text-sm text-gray-300 max-h-32 overflow-y-auto">
                        {selectedSubmission.content}
                    </div>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">
                                {t('developer.inbox.mission_control.award_tokens')} ({selectedMissionDetails.reward_min} - {selectedMissionDetails.reward_max})
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
                                {t('developer.inbox.mission_control.award_rep')} ({selectedMissionDetails.reward_rep_min} - {selectedMissionDetails.reward_rep_max})
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
                                {t('developer.inbox.mission_control.cancel')}
                            </button>
                            <button 
                                onClick={handleSubmitAward}
                                className="px-4 py-2 bg-green-500 text-black font-bold rounded hover:bg-green-400"
                            >
                                {t('developer.inbox.mission_control.approve_award')}
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
