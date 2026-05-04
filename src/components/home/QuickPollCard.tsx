import { useEffect, useState } from 'react';
import { Vote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { CommunityPoll, castCommunityPollVote, fetchActiveCommunityPoll } from '../../lib/community';

const QuickPollCard = ({ roomId }: { roomId?: string }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [poll, setPoll] = useState<CommunityPoll | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPoll = async () => {
    try {
      setPoll(await fetchActiveCommunityPoll(roomId));
    } catch (error) {
      console.error('Error loading community poll:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPoll();
  }, [roomId]);

  const handleVote = async (optionId: string) => {
    if (!poll || !user || poll.selected_option_id) return;
    setVoting(optionId);
    setError(null);
    try {
      await castCommunityPollVote(poll.id, optionId);
      await loadPoll();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t('home.community.poll.vote_failed'));
    } finally {
      setVoting(null);
    }
  };

  if (loading || !poll) return null;

  const totalVotes = poll.options.reduce((sum, option) => sum + option.votes, 0);

  return (
    <section className="py-16 bg-background">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-3xl rounded-lg border border-primary/30 bg-surface p-6">
          <div className="mb-6 flex items-start gap-4">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <Vote className="h-6 w-6" />
            </div>
            <div>
              <p className="font-mono text-sm uppercase tracking-wider text-secondary">{t('home.community.poll.label')}</p>
              <h2 className="mt-1 text-2xl font-bold text-white">{t(poll.question_key)}</h2>
              <p className="mt-2 text-sm text-text-secondary">
                {user ? t('home.community.poll.helper') : t('home.community.poll.login_prompt')}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {poll.options.map((option) => {
              const percentage = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
              const selected = poll.selected_option_id === option.id;
              return (
                <button
                  key={option.id}
                  disabled={!user || !!poll.selected_option_id || !!voting}
                  onClick={() => handleVote(option.id)}
                  className={`relative w-full overflow-hidden rounded border p-4 text-left transition-colors ${
                    selected
                      ? 'border-primary bg-primary/20 text-white'
                      : 'border-white/10 bg-background text-text-secondary hover:border-primary/50 hover:text-white disabled:hover:border-white/10 disabled:hover:text-text-secondary'
                  }`}
                >
                  <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${percentage}%` }} />
                  <div className="relative flex items-center justify-between gap-4">
                    <span className="font-mono">{t(option.option_key)}</span>
                    <span className="text-sm font-bold text-primary">
                      {voting === option.id ? t('home.community.poll.voting') : t('home.community.poll.vote_count', { count: option.votes, percentage })}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </section>
  );
};

export default QuickPollCard;
