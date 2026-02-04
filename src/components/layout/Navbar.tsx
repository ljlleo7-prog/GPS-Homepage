import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, Terminal, User, LogOut, Globe } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from 'react-i18next';

const Navbar = () => {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [username, setUsername] = useState<string>('');

  useEffect(() => {
    if (user?.user_metadata?.username) {
      setUsername(user.user_metadata.username);
    } else if (user?.email) {
      setUsername(user.email.split('@')[0]);
    }
  }, [user]);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsOpen(false);
  }, [location]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'zh' : 'en';
    i18n.changeLanguage(newLang);
  };

  const navLinks = [
    { name: t('navbar.home'), path: '/' },
    { name: t('navbar.news'), path: '/news' },
    { name: t('navbar.products'), path: '/products' },
    { name: t('navbar.about'), path: '/about' },
    { name: t('navbar.contact'), path: '/contact' },
  ];

  return (
    <nav
      className={`fixed top-0 w-full z-50 transition-all duration-300 ${
        scrolled ? 'bg-background/90 backdrop-blur-md border-b border-surface' : 'bg-transparent'
      }`}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <Link to="/" className="flex items-center space-x-2 group">
            <Terminal className="h-8 w-8 text-primary group-hover:text-secondary transition-colors duration-300" />
            <span className="font-mono text-xl font-bold tracking-wider group-hover:text-shadow-neon-blue transition-all duration-300">
              GPS
            </span>
          </Link>

          <div className="hidden md:flex items-center space-x-8">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`font-mono text-sm tracking-widest uppercase hover:text-primary transition-colors duration-300 ${
                  location.pathname === link.path ? 'text-primary' : 'text-text-secondary'
                }`}
              >
                {link.name}
              </Link>
            ))}

            <button
              onClick={toggleLanguage}
              className="text-text-secondary hover:text-primary transition-colors flex items-center space-x-1"
              title="Switch Language"
            >
              <Globe className="w-5 h-5" />
              <span className="font-mono text-sm uppercase">{i18n.language}</span>
            </button>

            {user ? (
              <div className="flex items-center space-x-4 pl-8 border-l border-white/10">
                <div className="flex items-center space-x-2 text-primary">
                  <User className="w-5 h-5" />
                  <span className="font-mono text-sm">{username}</span>
                </div>
                <button
                  onClick={handleSignOut}
                  className="text-text-secondary hover:text-red-400 transition-colors"
                  title={t('navbar.sign_out')}
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <Link
                to="/login"
                className="px-4 py-2 bg-primary/10 border border-primary text-primary rounded-md font-mono text-sm hover:bg-primary hover:text-background transition-all duration-300"
              >
                {t('navbar.login')}
              </Link>
            )}
          </div>

          <div className="md:hidden flex items-center space-x-4">
            <button
              onClick={toggleLanguage}
              className="text-text-secondary hover:text-primary transition-colors flex items-center space-x-1"
            >
              <Globe className="w-5 h-5" />
              <span className="font-mono text-sm uppercase">{i18n.language}</span>
            </button>
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="text-text-primary hover:text-primary transition-colors"
            >
              {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-surface border-b border-surface/50"
          >
            <div className="px-4 pt-2 pb-6 space-y-2">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`block px-3 py-2 font-mono text-base font-medium rounded-md hover:bg-background hover:text-primary transition-all duration-300 ${
                    location.pathname === link.path
                      ? 'text-primary bg-background/50'
                      : 'text-text-secondary'
                  }`}
                >
                  {link.name}
                </Link>
              ))}
              
              {user ? (
                <>
                  <div className="px-3 py-2 text-primary font-mono flex items-center space-x-2 border-t border-white/10 mt-2 pt-4">
                    <User className="w-5 h-5" />
                    <span>{username}</span>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-3 py-2 text-text-secondary hover:text-red-400 font-mono flex items-center space-x-2"
                  >
                    <LogOut className="w-5 h-5" />
                    <span>{t('navbar.sign_out')}</span>
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  className="block px-3 py-2 mt-4 text-center bg-primary/10 border border-primary text-primary rounded-md font-mono hover:bg-primary hover:text-background transition-all duration-300"
                >
                  {t('navbar.login')}
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
