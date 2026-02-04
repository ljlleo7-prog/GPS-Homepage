import { motion } from 'framer-motion';
import { Code, Smartphone, Database, Globe, Layers, Cpu } from 'lucide-react';

const services = [
  {
    icon: <Code className="w-8 h-8" />,
    title: 'Web Development',
    description: 'Building responsive, high-performance websites using modern frameworks like React and Vue.'
  },
  {
    icon: <Smartphone className="w-8 h-8" />,
    title: 'Mobile Apps',
    description: 'Creating native and cross-platform mobile applications that deliver seamless user experiences.'
  },
  {
    icon: <Database className="w-8 h-8" />,
    title: 'Backend Systems',
    description: 'Designing robust, scalable backend architectures and APIs to power your digital products.'
  },
  {
    icon: <Globe className="w-8 h-8" />,
    title: 'Digital Strategy',
    description: 'Developing comprehensive digital strategies to help your business grow and thrive online.'
  },
  {
    icon: <Layers className="w-8 h-8" />,
    title: 'UI/UX Design',
    description: 'Crafting intuitive and visually stunning user interfaces that engage and delight users.'
  },
  {
    icon: <Cpu className="w-8 h-8" />,
    title: 'Tech Consulting',
    description: 'Providing expert advice on technology choices, architecture, and best practices.'
  }
];

const Services = () => {
  return (
    <section className="py-20 bg-surface relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary/5 rounded-full blur-3xl" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Our <span className="text-secondary">Services</span>
          </h2>
          <p className="text-text-secondary max-w-2xl mx-auto">
            We offer a comprehensive range of digital services to help you build, launch, and scale your products.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              viewport={{ once: true }}
              className="p-8 bg-background border border-white/5 rounded-lg hover:border-primary/50 hover:shadow-[0_0_15px_rgba(0,212,255,0.1)] transition-all duration-300 group"
            >
              <div className="mb-6 p-4 bg-surface rounded-full w-16 h-16 flex items-center justify-center text-primary group-hover:text-secondary group-hover:scale-110 transition-all duration-300">
                {service.icon}
              </div>
              <h3 className="text-xl font-bold mb-4 font-mono">{service.title}</h3>
              <p className="text-text-secondary group-hover:text-white transition-colors">
                {service.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Services;
