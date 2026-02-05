import { Terminal, Github, Twitter, Linkedin, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSiteContent } from '../../hooks/useSiteContent';

const Footer = () => {
  const { t } = useTranslation();
  const { content } = useSiteContent();

  return (
    <footer className="bg-surface border-t border-white/5 py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <Link to="/" className="flex items-center space-x-2 group mb-4">
              <img 
                src="/GPS-logo.jpg" 
                alt="GPS Logo" 
                className="h-8 w-8 rounded-full object-cover border border-primary/20 group-hover:border-primary transition-colors duration-300" 
              />
              <span className="font-mono text-lg font-bold tracking-wider">
                GeeksProductionStudio
              </span>
            </Link>
            <p className="text-text-secondary max-w-sm mb-6">
              {t('footer.tagline')}
            </p>
            <div className="flex space-x-4">
              <a href={content.social_github} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-primary transition-colors">
                <Github className="h-5 w-5" />
              </a>
              <a href={content.social_twitter} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-primary transition-colors">
                <Twitter className="h-5 w-5" />
              </a>
              <a href={content.social_linkedin} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-primary transition-colors">
                <Linkedin className="h-5 w-5" />
              </a>
              <a href={`mailto:${content.contact_email_primary}`} className="text-text-secondary hover:text-primary transition-colors">
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="font-mono text-lg font-semibold text-white mb-4">Navigation</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/" className="text-text-secondary hover:text-primary transition-colors">
                  {t('navbar.home')}
                </Link>
              </li>
              <li>
                <Link to="/news" className="text-text-secondary hover:text-primary transition-colors">
                  {t('navbar.news')}
                </Link>
              </li>
              <li>
                <Link to="/about" className="text-text-secondary hover:text-primary transition-colors">
                  {t('navbar.about')}
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-text-secondary hover:text-primary transition-colors">
                  {t('navbar.contact')}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-mono text-lg font-semibold text-white mb-4">{t('footer.connect')}</h3>
            <ul className="space-y-2 text-text-secondary">
              <li>{t('footer.location.remote')}</li>
              <li>{t('footer.location.wifi')}</li>
              <li>{content.contact_email_full}</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 text-center text-text-secondary text-sm font-mono">
          <div className="mb-4 p-4 border border-yellow-500/30 bg-yellow-500/10 rounded text-yellow-200/90 text-sm font-bold">
             {t('footer.disclaimer')}
          </div>
          <p>&copy; {new Date().getFullYear()} GeeksProductionStudio. {t('footer.copyright')}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
