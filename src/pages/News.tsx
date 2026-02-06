import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Search, PlusCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import ArticleCard from '../components/news/ArticleCard';
import PostNewsModal from '../components/news/PostNewsModal';
import { useEconomy } from '../context/EconomyContext';

interface Article {
  id: string;
  title: string;
  excerpt: string;
  image_url: string;
  category: string;
  published_at: string;
  author: string;
}

const categories = ['All', 'Company News', 'Technology', 'Projects'];

const News = () => {
  const { t } = useTranslation();
  const { developerStatus } = useEconomy();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);

  useEffect(() => {
    fetchArticles();
  }, []);

  const fetchArticles = async () => {
    try {
      const { data, error } = await supabase
        .from('news_articles')
        .select('*')
        .order('published_at', { ascending: false });

      if (error) throw error;
      setArticles(data || []);
    } catch (error) {
      console.error('Error fetching articles:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredArticles = articles.filter((article) => {
    const matchesCategory = selectedCategory === 'All' || article.category === selectedCategory;
    const matchesSearch = article.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          article.excerpt.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen py-12 bg-background">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-bold mb-4"
          >
            {t('news.title_latest')} <span className="text-primary">{t('news.title_updates')}</span>
          </motion.h1>
          <p className="text-text-secondary max-w-2xl mx-auto">
            {t('news.subtitle')}
          </p>
        </div>

        {/* Filter and Search */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-12 space-y-4 md:space-y-0">
          <div className="flex flex-wrap justify-center gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-full font-mono text-sm transition-all duration-300 ${
                  selectedCategory === category
                    ? 'bg-primary text-background font-bold shadow-[0_0_10px_rgba(0,212,255,0.3)]'
                    : 'bg-surface text-text-secondary hover:text-white hover:bg-white/10'
                }`}
              >
                {t(`news.categories.${category.toLowerCase().replace(' ', '_')}`)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto">
            {developerStatus === 'APPROVED' && (
              <button
                onClick={() => setIsPostModalOpen(true)}
                className="flex items-center px-4 py-2 bg-secondary/10 border border-secondary text-secondary rounded-full font-mono text-sm hover:bg-secondary hover:text-background transition-all duration-300"
              >
                <PlusCircle className="w-4 h-4 mr-2" />
                {t('news.post_btn')}
              </button>
            )}

            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary w-4 h-4" />
              <input
                type="text"
                placeholder={t('news.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface border border-white/10 rounded-full pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>
        </div>

        <PostNewsModal 
          isOpen={isPostModalOpen} 
          onClose={() => setIsPostModalOpen(false)} 
          onSuccess={fetchArticles} 
        />

        {/* Articles Grid */}
        {loading ? (
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredArticles.length > 0 ? (
              filteredArticles.map((article, index) => (
                <ArticleCard 
                  key={article.id} 
                  article={article} 
                  index={index} 
                  onDelete={fetchArticles}
                />
              ))
            ) : (
              <div className="col-span-full text-center py-20 text-text-secondary">
                {t('news.no_results')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default News;
