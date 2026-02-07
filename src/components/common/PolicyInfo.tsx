import { useState } from 'react';
import { Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

interface PolicyInfoProps {
  titleKey: string;
  contentKey: string;
  className?: string;
}

export const PolicyInfo = ({ titleKey, contentKey, className = "" }: PolicyInfoProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className={`text-text-secondary hover:text-primary transition-colors inline-flex items-center gap-1 ${className}`}
        title={t('policies.click_for_info')}
      >
        <Info size={16} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 overflow-y-auto backdrop-blur-sm">
            <div 
              className="absolute inset-0" 
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface border border-white/20 rounded-lg p-6 max-w-lg w-full relative z-10 shadow-xl"
            >
              <button 
                onClick={() => setIsOpen(false)}
                className="absolute top-4 right-4 text-text-secondary hover:text-white"
              >
                <X size={20} />
              </button>
              
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Info className="text-primary" size={24} />
                {t(titleKey)}
              </h3>
              
              <div className="text-text-secondary space-y-4 leading-relaxed whitespace-pre-line">
                {t(contentKey)}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
