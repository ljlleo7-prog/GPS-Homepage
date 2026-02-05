import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const Timeline = () => {
  const { t } = useTranslation();

  const milestones = [
    {
      year: t('about.timeline.milestone1.year'),
      title: t('about.timeline.milestone1.title'),
      description: t('about.timeline.milestone1.desc')
    },
    {
      year: t('about.timeline.milestone2.year'),
      title: t('about.timeline.milestone2.title'),
      description: t('about.timeline.milestone2.desc')
    },
    {
      year: t('about.timeline.milestone3.year'),
      title: t('about.timeline.milestone3.title'),
      description: t('about.timeline.milestone3.desc')
    },
    {
      year: t('about.timeline.milestone4.year'),
      title: t('about.timeline.milestone4.title'),
      description: t('about.timeline.milestone4.desc')
    }
  ];

  return (
    <div className="relative border-l border-white/10 ml-4 md:ml-10 space-y-12 py-8">
      {milestones.map((item, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.1 }}
          viewport={{ once: true }}
          className="relative pl-8 md:pl-12"
        >
          {/* Dot */}
          <div className="absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_10px_#00d4ff]" />
          
          <div className="flex flex-col md:flex-row md:items-baseline md:space-x-4">
            <span className="text-secondary font-mono text-xl font-bold">{item.year}</span>
            <h3 className="text-white text-lg font-bold">{item.title}</h3>
          </div>
          <p className="mt-2 text-text-secondary max-w-lg">
            {item.description}
          </p>
        </motion.div>
      ))}
    </div>
  );
};

export default Timeline;
