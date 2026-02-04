import { motion } from 'framer-motion';
import Timeline from '../components/about/Timeline';
import TeamGrid from '../components/about/TeamGrid';

const About = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="py-20 relative overflow-hidden">
        <div className="container mx-auto px-4 text-center relative z-10">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-6xl font-bold mb-6"
          >
            Our <span className="text-primary">Story</span>
          </motion.h1>
          <p className="text-xl text-text-secondary max-w-3xl mx-auto">
            We are a collective of student developers, dreamers, and geeks united by a passion for technology and a drive to learn.
          </p>
        </div>
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_rgba(0,212,255,0.1)_0%,_transparent_70%)]" />
      </section>

      {/* Timeline Section */}
      <section className="py-20 bg-surface/30">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold mb-12 text-center md:text-left">
            <span className="border-b-4 border-secondary pb-2">Our</span> Journey
          </h2>
          <Timeline />
        </div>
      </section>

      {/* Mission & Values */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-6">Our Mission</h2>
              <p className="text-text-secondary text-lg mb-8 leading-relaxed">
                To explore the possibilities of code without limits. We strive to learn, build, and share our knowledge with the community, creating a space where passion meets practice.
              </p>
              <h2 className="text-3xl font-bold mb-6">Core Values</h2>
              <ul className="space-y-4">
                {[
                  'Curiosity driven learning',
                  'Community over competition',
                  'Open source everything',
                  'Fail fast, learn faster'
                ].map((value, index) => (
                  <li key={index} className="flex items-center text-text-secondary">
                    <span className="w-2 h-2 bg-secondary rounded-full mr-4" />
                    {value}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-secondary/20 rounded-lg transform rotate-3" />
              <div className="bg-surface border border-white/10 rounded-lg p-8 relative transform -rotate-3 hover:rotate-0 transition-transform duration-500">
                <blockquote className="text-xl font-mono italic text-white/80">
                  "Code is our canvas, and we are just getting started. Let's build something awesome together."
                </blockquote>
                <div className="mt-4 text-right text-primary font-bold">
                  - The GPS Team
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-20 bg-surface/30">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold mb-12 text-center">
            Meet the <span className="text-secondary">Geeks</span>
          </h2>
          <TeamGrid />
        </div>
      </section>
    </div>
  );
};

export default About;
