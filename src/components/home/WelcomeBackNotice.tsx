import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { CommunityNotification, fetchUnreadCommunityNotifications, markCommunityNotificationRead } from '../../lib/community';

const WelcomeBackNotice = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [notification, setNotification] = useState<CommunityNotification | null>(null);

  useEffect(() => {
    if (!user) return;

    const loadNotification = async () => {
      try {
        const items = await fetchUnreadCommunityNotifications();
        setNotification(items.find((item) => item.type === 'welcome_back') || null);
      } catch (error) {
        console.error('Error fetching community notifications:', error);
      }
    };

    loadNotification();
  }, [user]);

  const handleDismiss = async () => {
    if (!notification) return;
    setNotification(null);
    try {
      await markCommunityNotificationRead(notification.id);
    } catch (error) {
      console.error('Error dismissing community notification:', error);
    }
  };

  if (!notification) return null;

  return (
    <section className="py-6 bg-background">
      <div className="container mx-auto px-4">
        <div className="flex items-start gap-4 rounded-lg border border-primary/30 bg-primary/10 p-4 text-white">
          <Bell className="mt-1 h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1">
            <h2 className="font-mono text-lg font-bold text-primary">{t(notification.title_key)}</h2>
            <p className="mt-1 text-sm text-text-secondary">{t(notification.body_key, notification.metadata || {})}</p>
          </div>
          <button
            onClick={handleDismiss}
            className="rounded p-1 text-text-secondary transition-colors hover:bg-white/10 hover:text-white"
            aria-label={t('common.dismiss')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
};

export default WelcomeBackNotice;
