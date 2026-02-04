import { motion } from 'framer-motion';

const milestones = [
  {
    year: '2020',
    title: 'Inception',
    description: 'GeeksProductionStudio was founded by a group of passionate developers with a vision to redefine digital experiences.'
  },
  {
    year: '2021',
    title: 'First Major Project',
    description: 'Launched our flagship project "CyberCore", receiving critical acclaim for its innovative use of WebGL.'
  },
  {
    year: '2022',
    title: 'Global Expansion',
    description: 'Expanded our team and opened new offices in London and Tokyo to serve our growing international client base.'
  },
  {
    year: '2023',
    title: 'AI Integration',
    description: 'Established a dedicated AI research division to integrate machine learning into our production workflows.'
  },
  {
    year: '2024',
    title: 'Future Horizons',
    description: 'Continuing to push the boundaries of technology with new ventures in VR/AR and blockchain.'
  }
];

const Timeline = () => {
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
