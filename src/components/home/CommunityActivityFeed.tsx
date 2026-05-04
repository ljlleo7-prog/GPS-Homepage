import { useEffect, useState } from 'react';
import { Activity, LucideIcon, MessageCircle, Trophy, Vote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CommunityActivityItem, fetchHomepageActivityFeed } from '../../lib/community';

const eventIcons: Record<string, LucideIcon> = {
  forum_post_created: MessageCircle,
  forum_comment_created: MessageCircle,
  poll_vote_cast: Vote,
  minigame_play_completed: Trophy
};

const CommunityActivityFeed = () => {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<CommunityActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadFeed = async () => {
      try {
        setItems(await fetchHomepageActivityFeed(8));
      } catch (error) {
        console.error('Error loading community activity feed:', error);
      } finally {
        setLoading(false);
      }
    };

    loadFeed();
  }, []);

  return (
    <section className="py-16 bg-background">
      <div className="container mx-auto px-4">
        <div className="mb-8">
          <h2 className="text-3xl font-bold">
            <span className="text-primary">{t('home.community.feed.title_active')}</span> {t('home.community.feed.title_pulse')}
          </h2>
          <p className="mt-2 max-w-2xl text-text-secondary font-mono">{t('home.community.feed.subtitle')}</p>
        </div>

        <div className="rounded-lg border border-white/10 bg-surface p-4">
          {loading ? (
            <p className="py-8 text-center font-mono text-text-secondary">{t('home.community.loading')}</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center font-mono text-text-secondary">{t('home.community.feed.empty')}</p>
          ) : (
            <div className="divide-y divide-white/10">
              {items.map((item) => {
                const Icon = eventIcons[item.event_type] || Activity;
                return (
                  <div key={item.id} className="flex items-center gap-4 py-4">
                    <div className="rounded-full bg-primary/10 p-2 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-white">
                        <span className="font-semibold text-primary">{item.username}</span>{' '}
                        {t(`home.community.feed.events.${item.event_type}`, { defaultValue: t('home.community.feed.events.default') })}
                      </p>
                      <p className="mt-1 text-xs font-mono text-text-secondary">
                        {new Date(item.created_at).toLocaleString(i18n.language)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default CommunityActivityFeed;
