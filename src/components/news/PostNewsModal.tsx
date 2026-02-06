import { useState } from 'react';
import { X, Upload, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from 'react-i18next';

interface PostNewsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const categories = ['Company News', 'Technology', 'Projects'];

const PostNewsModal = ({ isOpen, onClose, onSuccess }: PostNewsModalProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    excerpt: '',
    content: '',
    category: categories[0],
    image_url: '',
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    try {
      // Get user profile for author name (or use username from metadata)
      // For simplicity, we'll use username or email part
      const authorName = user.user_metadata?.username || user.email?.split('@')[0] || 'Admin';

      const { error } = await supabase.from('news_articles').insert({
        title: formData.title,
        excerpt: formData.excerpt,
        content: formData.content,
        category: formData.category,
        image_url: formData.image_url,
        author: authorName, // Legacy field, keeping for compatibility
        // We rely on RLS to enforce developer status
      });

      if (error) throw error;

      onSuccess();
      onClose();
      // Reset form
      setFormData({
        title: '',
        excerpt: '',
        content: '',
        category: categories[0],
        image_url: '',
      });
    } catch (error) {
      console.error('Error posting news:', error);
      alert(t('news.post_modal.alerts.post_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-surface border border-white/10 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-surface border-b border-white/10 p-4 flex justify-between items-center z-10">
          <h2 className="text-xl font-bold">{t('news.post_modal.title')}</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-mono text-text-secondary mb-2">{t('news.post_modal.labels.title')}</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full bg-background border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-primary"
              placeholder={t('news.post_modal.placeholders.title')}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-mono text-text-secondary mb-2">{t('news.post_modal.labels.category')}</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full bg-background border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-primary"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-mono text-text-secondary mb-2">{t('news.post_modal.labels.image_url')}</label>
              <input
                type="url"
                required
                value={formData.image_url}
                onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                className="w-full bg-background border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-primary"
                placeholder="https://..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-mono text-text-secondary mb-2">{t('news.post_modal.labels.excerpt')}</label>
            <textarea
              required
              value={formData.excerpt}
              onChange={(e) => setFormData({ ...formData, excerpt: e.target.value })}
              className="w-full bg-background border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-primary h-20"
              placeholder={t('news.post_modal.placeholders.excerpt')}
            />
          </div>

          <div>
            <label className="block text-sm font-mono text-text-secondary mb-2">{t('news.post_modal.labels.content')}</label>
            <textarea
              required
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              className="w-full bg-background border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-primary h-60 font-mono text-sm"
              placeholder={t('news.post_modal.placeholders.content')}
            />
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              disabled={loading}
              className="px-8 py-3 bg-primary text-background font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  {t('news.post_modal.buttons.publishing')}
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5 mr-2" />
                  {t('news.post_modal.buttons.publish')}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PostNewsModal;
