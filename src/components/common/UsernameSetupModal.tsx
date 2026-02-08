import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useEconomy } from '../../context/EconomyContext';
import { X, User, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const UsernameSetupModal = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { username, refreshEconomy } = useEconomy();
  const [isOpen, setIsOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Show modal if user is logged in but has "Awaiting" username (or null just in case)
    // Check if username contains "Awaiting" (case-insensitive) as per user request
    if (user && (username === null || username?.toLowerCase().includes('awaiting'))) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [user, username]);

  const handleSkip = () => {
    setIsOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) return;

    setLoading(true);
    setError(null);

    try {
      // Check if username is taken
      const { data: existingUser, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', newUsername.trim())
        .maybeSingle();

      if (checkError) throw checkError;
      if (existingUser) {
        throw new Error(t('auth.username_setup.error_taken'));
      }

      // Update username
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ username: newUsername.trim() })
        .eq('id', user?.id);

      if (updateError) throw updateError;

      // Refresh economy context to update username state
      await refreshEconomy();
      setIsOpen(false);
    } catch (err: any) {
      setError(err.message || t('auth.username_setup.error_generic'));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-md bg-card border border-border rounded-lg shadow-xl overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4 text-primary">
              <div className="p-2 rounded-full bg-primary/20">
                <User className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-white">{t('auth.username_setup.title')}</h2>
            </div>
            
            <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 rounded p-3 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-200">
                {t('auth.username_setup.apology')}
              </p>
            </div>
            
            <p className="text-gray-400 mb-6">
              {t('auth.username_setup.subtitle')}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-400 mb-1">
                  {t('auth.username_setup.username_label')}
                </label>
                <input
                  id="username"
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                  placeholder={t('auth.username_setup.username_placeholder')}
                  minLength={3}
                  maxLength={20}
                  pattern="^[a-zA-Z0-9_]+$"
                  title="Alphanumeric characters and underscores only"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('auth.username_setup.helper_text')}
                </p>
              </div>

              {error && (
                <div className="p-3 rounded bg-red-500/20 border border-red-500/50 text-red-200 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 px-4 bg-primary hover:bg-primary/90 text-background font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? t('auth.username_setup.loading') : t('auth.username_setup.submit')}
              </button>
              
              <button
                type="button"
                onClick={handleSkip}
                className="w-full py-2 px-4 bg-transparent border border-gray-600 hover:border-gray-400 text-gray-400 hover:text-white rounded transition-colors"
              >
                {t('common.skip_for_now', 'Skip for now')}
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default UsernameSetupModal;
