import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';

const Layout = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background text-text-primary">
      <Navbar />
      <div className="bg-yellow-500/20 border-b border-yellow-500/20 text-yellow-200 text-xs py-1 px-4 text-center font-mono">
        DISCLAIMER: This is a simulation. Tokens and Reputation have NO real-world monetary value. For community engagement only.
      </div>
      <main className="flex-grow pt-0">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};

export default Layout;
