import { motion } from 'framer-motion';
import { Lock, CheckCircle, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export interface Product {
  id: string;
  name: string;
  category: 'aviation' | 'motorsports';
  type: 'computerized-simulation' | 'boardgame';
  access: 'open' | 'authorized';
  description: string;
  mechanism: string;
  action: string;
  url?: string;
  icon: React.ReactNode;
}

interface ProductCardProps {
  product: Product;
  user: any;
}

const ProductCard = ({ product, user }: ProductCardProps) => {
  const { t } = useTranslation();
  const isAuthorized = user && product.access === 'authorized';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="bg-surface border border-white/10 rounded-lg p-6 hover:border-primary/30 transition-colors"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-background rounded-full border border-white/5 text-primary">
          {product.icon}
        </div>
        <div className="flex items-center text-sm font-mono">
          {product.access === 'open' ? (
            <>
              <CheckCircle className="w-4 h-4 text-green-500 mr-1" />
              <span className="text-green-500">{t('products.access.open')}</span>
            </>
          ) : (
            <>
              <Lock className="w-4 h-4 text-yellow-500 mr-1" />
              <span className="text-yellow-500">{t('products.access.authorized')}</span>
            </>
          )}
        </div>
      </div>
      
      <div className="mb-4">
        <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded border border-primary/20">
          {product.type === 'computerized-simulation' ? t('products.type.simulation') : t('products.type.boardgame')}
        </span>
      </div>

      <h3 className="text-xl font-bold mb-2 font-mono text-white">{product.name}</h3>
      <p className="text-text-secondary mb-4 text-sm">{product.description}</p>
      
      <div className="mb-6 p-4 bg-background/50 rounded border border-white/5">
        <h4 className="text-sm font-bold text-primary mb-2 font-mono uppercase tracking-wider">{t('products.mechanism_title')}</h4>
        <p className="text-sm text-text-secondary font-mono leading-relaxed">{product.mechanism}</p>
      </div>

      <button
        onClick={() => {
          if (product.url && (product.access === 'open' || isAuthorized)) {
            window.open(product.url, '_blank');
          }
        }}
        className={`w-full py-2 rounded-md font-mono text-sm flex items-center justify-center transition-all ${
          product.access === 'open' || isAuthorized
            ? 'bg-primary text-background hover:bg-secondary'
            : 'bg-surface border border-white/10 text-text-secondary cursor-not-allowed'
        }`}
        disabled={product.access === 'authorized' && !isAuthorized}
      >
        <span>{product.action}</span>
        {(product.access === 'open' || isAuthorized) && <ExternalLink className="w-4 h-4 ml-2" />}
        {product.access === 'authorized' && !isAuthorized && <Lock className="w-4 h-4 ml-2" />}
      </button>
    </motion.div>
  );
};

export default ProductCard;
