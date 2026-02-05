import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Shield, CheckCircle, XCircle, FileText, MessageSquare, Trophy, AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useEconomy } from '../context/EconomyContext';
import { useNavigate } from 'react-router-dom';

interface InboxData {
  pending_devs: PendingDev[];
  pending_missions: PendingMission[];
  active_bets: ActiveBet[];
  pending_acks: PendingAck[];
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

const DeveloperInbox = () => {
  const { t } = useTranslation();
  const { developerStatus, approveDeveloperAccess, resolveDriverBet } = useEconomy();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InboxData>({
    pending_devs: [],
    pending_missions: [],
    active_bets: [],
    pending_acks: []
  });

  useEffect(() => {
    if (developerStatus === 'APPROVED') {
      fetchInbox();
    }
  }, [developerStatus]);

  const fetchInbox = async () => {
    setLoading(true);
    try {
      const { data: result, error } = await supabase.rpc('get_developer_inbox');
      if (error) throw error;
      if (result && result.success) {
        setData({
          pending_devs: result.pending_devs,
          pending_missions: result.pending_missions,
          active_bets: result.active_bets,
          pending_acks: result.pending_acks
        });
      }
    } catch (error) {
      console.error('Error fetching inbox:', error);
    } finally {
      setLoading(false);
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
        const { error } = await supabase
            .from('profiles')
            .update({ developer_status: 'NONE' }) // Reset to NONE or add REJECTED if needed
            .eq('id', id);
        
        if (error) throw error;
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

  if (developerStatus !== 'APPROVED') {
      return (
          <div className="min-h-screen bg-background pt-24 text-center text-white">
              <div className="max-w-md mx-auto p-6 bg-surface border border-red-500/30 rounded-lg">
                  <Shield size={48} className="mx-auto text-red-500 mb-4" />
                  <h2 className="text-xl font-bold mb-2">Access Denied</h2>
                  <p className="text-text-secondary">You must be an approved developer to view this page.</p>
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
            Developer Inbox
          </h1>
          <button 
            onClick={fetchInbox}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded hover:bg-white/10 text-sm font-mono text-text-secondary"
          >
            Refresh
          </button>
        </motion.div>

        {loading ? (
             <div className="text-center text-text-secondary py-12">Loading inbox data...</div>
        ) : (
            <div className="space-y-8">
                {/* 1. Pending Developer Requests */}
                <Section title="Pending Developer Requests" icon={<UserIcon />} count={data.pending_devs.length}>
                    {data.pending_devs.length === 0 ? (
                        <EmptyState message="No pending developer requests" />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_devs.map(dev => (
                                <Card key={dev.id}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="font-bold text-white text-lg">{dev.username}</h3>
                                            <p className="text-sm text-text-secondary">Full Name: {dev.full_name}</p>
                                            <p className="text-xs text-text-secondary mt-1">Requested: {new Date(dev.created_at).toLocaleDateString()}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <ActionButton 
                                                onClick={() => handleApproveDev(dev.id)} 
                                                variant="approve"
                                                label="Approve"
                                            />
                                            <ActionButton 
                                                onClick={() => handleDeclineDev(dev.id)} 
                                                variant="reject"
                                                label="Decline"
                                            />
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 2. Pending Mission Submissions */}
                <Section title="Pending Mission Submissions" icon={<TrophyIcon />} count={data.pending_missions.length}>
                    {data.pending_missions.length === 0 ? (
                        <EmptyState message="No pending mission submissions" />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_missions.map(sub => (
                                <Card key={sub.id}>
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 mr-4">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-primary/20 text-primary text-xs px-2 py-0.5 rounded border border-primary/30 font-mono">
                                                    MISSION
                                                </span>
                                                <h3 className="font-bold text-white">{sub.mission_title}</h3>
                                            </div>
                                            <p className="text-sm text-text-secondary mb-2">by <span className="text-white">{sub.submitter_name}</span></p>
                                            <div className="bg-black/30 p-3 rounded border border-white/5 text-sm font-mono text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                                {sub.content}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <ActionButton 
                                                onClick={() => handleApproveMission(sub.id)} 
                                                variant="approve"
                                                label="Approve"
                                            />
                                            <ActionButton 
                                                onClick={() => handleRejectMission(sub.id)} 
                                                variant="reject"
                                                label="Reject"
                                            />
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 3. Active Driver Bets (Resolution Needed) */}
                <Section title="Active Driver Bets (Needs Resolution)" icon={<AlertTriangleIcon />} count={data.active_bets.length}>
                     {data.active_bets.length === 0 ? (
                        <EmptyState message="No active bets needing resolution" />
                    ) : (
                        <div className="grid gap-4">
                            {data.active_bets.map(bet => (
                                <Card key={bet.id}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-secondary/20 text-secondary text-xs px-2 py-0.5 rounded border border-secondary/30 font-mono">
                                                    DRIVER BET
                                            </span>
                                            <h3 className="font-bold text-white">{bet.title}</h3>
                                        </div>
                                        <p className="text-sm text-text-secondary mb-2">by <span className="text-white">{bet.creator_name || 'Unknown'}</span></p>
                                        <p className="text-sm text-text-secondary mb-2">{bet.description}</p>
                                        <p className="text-xs text-text-secondary">End Date: {new Date(bet.official_end_date).toLocaleDateString()}</p>
                                    </div>
                                        <div className="flex flex-col gap-2 min-w-[140px]">
                                            <span className="text-xs text-center text-text-secondary mb-1">Declare Winner:</span>
                                            <button 
                                                onClick={() => handleResolveBetAction(bet.id, 'A')}
                                                className="px-3 py-1.5 bg-green-500/10 border border-green-500/30 text-green-400 rounded hover:bg-green-500/20 text-xs font-mono"
                                            >
                                                Side A: {bet.side_a_name}
                                            </button>
                                            <button 
                                                onClick={() => handleResolveBetAction(bet.id, 'B')}
                                                className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded hover:bg-red-500/20 text-xs font-mono"
                                            >
                                                Side B: {bet.side_b_name}
                                            </button>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>

                {/* 4. Forum Acknowledgements */}
                <Section title="Forum Acknowledgements" icon={<MessageSquareIcon />} count={data.pending_acks.length}>
                    {data.pending_acks.length === 0 ? (
                        <EmptyState message="No pending acknowledgements" />
                    ) : (
                        <div className="grid gap-4">
                            {data.pending_acks.map(ack => (
                                <Card key={ack.id}>
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <h3 className="font-bold text-white text-lg mb-1">{ack.title}</h3>
                                            <p className="text-sm text-text-secondary">
                                                Request by <span className="text-white">{ack.author_name}</span> • {new Date(ack.created_at).toLocaleDateString()}
                                            </p>
                                            <a href={`/community?post=${ack.id}`} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline flex items-center gap-1 mt-2">
                                                View Post <ExternalLink size={12} />
                                            </a>
                                        </div>
                                        <ActionButton 
                                            onClick={() => handleAcknowledgePost(ack.id)} 
                                            variant="neutral"
                                            label="Acknowledge"
                                        />
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </Section>
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
