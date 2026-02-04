import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plane, Car, Filter } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ProductCard, { Product } from '../components/products/ProductCard';
import { useTranslation } from 'react-i18next';

const Products = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [activeCategory, setActiveCategory] = useState<'all' | 'aviation' | 'motorsports'>('all');

  const products: Product[] = [
    {
      id: 'sim-aviation-001',
      name: t('products.items.flight_sim.name'),
      category: 'aviation',
      type: 'computerized-simulation',
      access: 'authorized',
      description: t('products.items.flight_sim.description'),
      mechanism: t('products.items.flight_sim.mechanism'),
      action: t('products.items.flight_sim.action'),
      icon: <Plane className="w-8 h-8" />
    },
    {
      id: 'boardgame-motorsports-001',
      name: t('products.items.race_strategy.name'),
      category: 'motorsports',
      type: 'boardgame',
      access: 'open',
      description: t('products.items.race_strategy.description'),
      mechanism: t('products.items.race_strategy.mechanism'),
      action: t('products.items.race_strategy.action'),
      icon: <Car className="w-8 h-8" />,
      url: 'http://deltadash.geeksproductionstudio.com/'
    },
    {
      id: 'sim-motorsports-002',
      name: t('products.items.telemetry.name'),
      category: 'motorsports',
      type: 'computerized-simulation',
      access: 'open',
      description: t('products.items.telemetry.description'),
      mechanism: t('products.items.telemetry.mechanism'),
      action: t('products.items.telemetry.action'),
      icon: <Car className="w-8 h-8" />
    },
    {
      id: 'sim-aviation-002',
      name: t('products.items.atc_sim.name'),
      category: 'aviation',
      type: 'computerized-simulation',
      access: 'authorized',
      description: t('products.items.atc_sim.description'),
      mechanism: t('products.items.atc_sim.mechanism'),
      action: t('products.items.atc_sim.action'),
      icon: <Plane className="w-8 h-8" />
    }
  ];

  const filteredProducts = activeCategory === 'all' 
    ? products 
    : products.filter(p => p.category === activeCategory);

  return (
    <div className="min-h-screen bg-background pt-24 pb-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-12 text-center"
        >
          <h1 className="text-4xl md:text-5xl font-bold font-mono mb-4 text-white">
            <span className="text-primary">&lt;</span> {t('products.title')} <span className="text-primary">/&gt;</span>
          </h1>
          <p className="text-text-secondary max-w-2xl mx-auto font-mono">
            {t('products.subtitle')}
          </p>
        </motion.div>

        <div className="flex justify-center mb-12 space-x-4">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-6 py-2 rounded-md font-mono transition-all border ${
              activeCategory === 'all' 
                ? 'bg-primary text-background border-primary' 
                : 'bg-transparent text-text-secondary border-white/10 hover:border-primary/50'
            }`}
          >
            {t('products.categories.all')}
          </button>
          <button
            onClick={() => setActiveCategory('aviation')}
            className={`px-6 py-2 rounded-md font-mono transition-all border flex items-center ${
              activeCategory === 'aviation' 
                ? 'bg-primary text-background border-primary' 
                : 'bg-transparent text-text-secondary border-white/10 hover:border-primary/50'
            }`}
          >
            <Plane className="w-4 h-4 mr-2" />
            {t('products.categories.aviation')}
          </button>
          <button
            onClick={() => setActiveCategory('motorsports')}
            className={`px-6 py-2 rounded-md font-mono transition-all border flex items-center ${
              activeCategory === 'motorsports' 
                ? 'bg-primary text-background border-primary' 
                : 'bg-transparent text-text-secondary border-white/10 hover:border-primary/50'
            }`}
          >
            <Car className="w-4 h-4 mr-2" />
            {t('products.categories.motorsports')}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} user={user} />
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="text-center py-20 text-text-secondary font-mono">
            {t('products.no_items')}
          </div>
        )}
      </div>
    </div>
  );
};

export default Products;
