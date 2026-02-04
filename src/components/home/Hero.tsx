import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChevronRight, Code, Cpu, Globe } from 'lucide-react';

const Hero = () => {
  return (
    <section className="relative h-screen flex items-center justify-center overflow-hidden bg-background">
      {/* Animated Background */}
      <div className="absolute inset-0 z-0 opacity-20">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,_#00d4ff_0%,_transparent_50%)] animate-pulse" />
        <div className="absolute top-1/2 left-1/4 w-96 h-96 bg-secondary/30 rounded-full blur-3xl animate-blob" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/30 rounded-full blur-3xl animate-blob animation-delay-2000" />
      </div>

      {/* Grid Overlay */}
      <div className="absolute inset-0 z-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px]" />

      <div className="container mx-auto px-4 z-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="flex justify-center mb-6 space-x-4">
            <Code className="w-8 h-8 text-primary animate-bounce" />
            <Cpu className="w-8 h-8 text-secondary animate-bounce animation-delay-100" />
            <Globe className="w-8 h-8 text-primary animate-bounce animation-delay-200" />
          </div>
          
          <h1 className="text-5xl md:text-7xl font-mono font-bold mb-6 tracking-tighter">
            <span className="text-white">Geeks</span>
            <span className="text-primary text-shadow-neon-blue">Production</span>
            <span className="text-secondary text-shadow-neon-green">Studio</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-text-secondary mb-10 max-w-2xl mx-auto font-light">
            Student developers fueled by coffee, code, and curiosity. Building the future, one commit at a time.
          </p>
          
          <div className="flex flex-col md:flex-row justify-center space-y-4 md:space-y-0 md:space-x-6">
            <Link
              to="/news"
              className="px-8 py-3 bg-primary/10 border border-primary text-primary rounded-md font-mono hover:bg-primary hover:text-background transition-all duration-300 shadow-[0_0_15px_rgba(0,212,255,0.3)] hover:shadow-[0_0_25px_rgba(0,212,255,0.6)]"
            >
              See Our Work
            </Link>
            <Link
              to="/contact"
              className="px-8 py-3 bg-secondary/10 border border-secondary text-secondary rounded-md font-mono hover:bg-secondary hover:text-background transition-all duration-300 shadow-[0_0_15px_rgba(57,255,20,0.3)] hover:shadow-[0_0_25px_rgba(57,255,20,0.6)] flex items-center justify-center"
            >
              Join Our Community <ChevronRight className="ml-2 w-4 h-4" />
            </Link>
          </div>
        </motion.div>
      </div>
      
      {/* Scroll Indicator */}
      <motion.div
        className="absolute bottom-10 left-1/2 transform -translate-x-1/2"
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <div className="w-6 h-10 border-2 border-text-secondary rounded-full flex justify-center p-1">
          <div className="w-1 h-2 bg-primary rounded-full" />
        </div>
      </motion.div>
    </section>
  );
};

export default Hero;
