import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase';
import { Terminal, Lock, User as UserIcon, Mail, Loader } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const Register = () => {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (username.length < 3) {
      setError(t('auth.register.error_username'));
      setLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
          },
        },
      });

      if (error) throw error;
      
      // Auto sign in or redirect
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-20 flex items-center justify-center bg-background px-4">
      <div className="absolute inset-0 overflow-hidden z-0">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-blob" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-secondary/10 rounded-full blur-3xl animate-blob animation-delay-2000" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface/50 backdrop-blur-md border border-white/10 p-8 rounded-xl shadow-2xl w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-secondary/10 rounded-full">
              <Terminal className="w-8 h-8 text-secondary" />
            </div>
          </div>
          <h2 className="text-2xl font-bold font-mono text-white">{t('auth.register.title')}</h2>
          <p className="text-text-secondary mt-2">{t('auth.register.subtitle')}</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-500 p-3 rounded-md mb-6 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2 font-mono">
              {t('auth.register.username_label')}
            </label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-secondary" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-background border border-white/10 rounded-md py-2 pl-10 pr-4 text-white focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                placeholder={t('auth.register.username_placeholder')}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2 font-mono">
              {t('auth.register.email_label')}
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-secondary" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-background border border-white/10 rounded-md py-2 pl-10 pr-4 text-white focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                placeholder={t('auth.register.email_placeholder')}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2 font-mono">
              {t('auth.register.password_label')}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-secondary" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-background border border-white/10 rounded-md py-2 pl-10 pr-4 text-white focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-colors"
                placeholder={t('auth.register.password_placeholder')}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-secondary/10 border border-secondary text-secondary rounded-md py-2 font-mono hover:bg-secondary hover:text-background transition-all duration-300 flex items-center justify-center"
          >
            {loading ? <Loader className="w-5 h-5 animate-spin" /> : t('auth.register.submit')}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-text-secondary">
          {t('auth.register.existing_user')}{' '}
          <Link to="/login" className="text-primary hover:underline">
            {t('auth.register.login_link')}
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default Register;
