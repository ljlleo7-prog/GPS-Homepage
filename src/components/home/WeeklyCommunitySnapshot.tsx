import { useEffect, useState } from 'react';
import { MessageSquare, Users, Vote, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WeeklyCommunitySnapshot as Snapshot, fetchWeeklyCommunitySnapshot } from '../../lib/community';

const WeeklyCommunitySnapshot = () => {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSnapshot = async () => {
      try {
        setSnapshot(await fetchWeeklyCommunitySnapshot());
      } catch (error) {
        console.error('Error loading weekly community snapshot:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSnapshot();
  }, []);

  const stats = [
    { key: 'active_participants', icon: Users, value: snapshot?.active_participants || 0 },
    { key: 'forum_posts', icon: MessageSquare, value: (snapshot?.forum_posts || 0) + (snapshot?.forum_comments || 0) },
    { key: 'poll_votes', icon: Vote, value: snapshot?.poll_votes || 0 },
    { key: 'pending_scores', icon: ShieldCheck, value: snapshot?.pending_scores || 0 }
  ];

  return (
    <section className="py-16 bg-surface">
      <div className="container mx-auto px-4">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold text-white">{t('home.community.snapshot.title')}</h2>
          <p className="mt-2 text-text-secondary font-mono">{t('home.community.snapshot.subtitle')}</p>
        </div>

        {loading ? (
          <p className="text-center font-mono text-text-secondary">{t('home.community.loading')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map(({ key, icon: Icon, value }) => (
              <div key={key} className="rounded-lg border border-white/10 bg-background p-6 text-center">
                <Icon className="mx-auto mb-3 h-6 w-6 text-primary" />
                <div className="text-3xl font-bold text-white">{value}</div>
                <div className="mt-2 text-sm font-mono text-text-secondary">{t(`home.community.snapshot.stats.${key}`)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default WeeklyCommunitySnapshot;
