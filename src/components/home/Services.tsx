import { motion } from 'framer-motion';
import { Code, Smartphone, Database, Globe, Layers, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const Services = () => {
  const { t } = useTranslation();

  const services = [
    {
      icon: <Code className="w-8 h-8" />,
      title: t('home.services.items.web_projects'),
      description: t('home.services.items.web_projects_desc')
    },
    {
      icon: <Smartphone className="w-8 h-8" />,
      title: t('home.services.items.mobile_experiments'),
      description: t('home.services.items.mobile_experiments_desc')
    },
    {
      icon: <Database className="w-8 h-8" />,
      title: t('home.services.items.open_source'),
      description: t('home.services.items.open_source_desc')
    },
    {
      icon: <Globe className="w-8 h-8" />,
      title: t('home.services.items.hackathons'),
      description: t('home.services.items.hackathons_desc')
    },
    {
      icon: <Layers className="w-8 h-8" />,
      title: t('home.services.items.creative_coding'),
      description: t('home.services.items.creative_coding_desc')
    },
    {
      icon: <Cpu className="w-8 h-8" />,
      title: t('home.services.items.learning_together'),
      description: t('home.services.items.learning_together_desc')
    }
  ];

  return (
    <section className="py-20 bg-surface relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary/5 rounded-full blur-3xl" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            {t('home.services.title')}
          </h2>
          <p className="text-text-secondary max-w-2xl mx-auto">
            {t('home.services.subtitle')}
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
