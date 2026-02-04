import { Terminal, Github, Twitter, Linkedin, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-surface border-t border-white/5 py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <Link to="/" className="flex items-center space-x-2 group mb-4">
              <Terminal className="h-6 w-6 text-primary group-hover:text-secondary transition-colors duration-300" />
              <span className="font-mono text-lg font-bold tracking-wider">
                GeeksProductionStudio
              </span>
            </Link>
            <p className="text-text-secondary max-w-sm mb-6">
              Student developers building the future. 
              Where passion meets code.
            </p>
            <div className="flex space-x-4">
              <a href="#" className="text-text-secondary hover:text-primary transition-colors">
                <Github className="h-5 w-5" />
              </a>
              <a href="#" className="text-text-secondary hover:text-primary transition-colors">
                <Twitter className="h-5 w-5" />
              </a>
              <a href="#" className="text-text-secondary hover:text-primary transition-colors">
                <Linkedin className="h-5 w-5" />
              </a>
              <a href="mailto:hello@gps.studio" className="text-text-secondary hover:text-primary transition-colors">
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>

          <div>
            <h3 className="font-mono text-lg font-semibold text-white mb-4">Navigation</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/" className="text-text-secondary hover:text-primary transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/news" className="text-text-secondary hover:text-primary transition-colors">
                  News
                </Link>
              </li>
              <li>
                <Link to="/about" className="text-text-secondary hover:text-primary transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-text-secondary hover:text-primary transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-mono text-lg font-semibold text-white mb-4">Connect</h3>
            <ul className="space-y-2 text-text-secondary">
              <li>Remote / On Campus</li>
              <li>Everywhere there is Wi-Fi</li>
              <li>hello@geeksproductionstudio.com</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 text-center text-text-secondary text-sm font-mono">
          <p>&copy; {new Date().getFullYear()} GeeksProductionStudio. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
