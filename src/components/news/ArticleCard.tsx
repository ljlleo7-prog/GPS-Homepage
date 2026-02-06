import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Calendar, User, Trash2 } from 'lucide-react';
import { useEconomy } from '../../context/EconomyContext';
import { supabase } from '../../lib/supabase';

import { useTranslation } from 'react-i18next';

interface Article {
  id: string;
  title: string;
  excerpt: string;
  image_url: string;
  category: string;
  published_at: string;
  author: string;
}

interface ArticleCardProps {
  article: Article;
  index: number;
  onDelete?: () => void;
}

const ArticleCard = ({ article, index, onDelete }: ArticleCardProps) => {
  const { t } = useTranslation();
  const { developerStatus } = useEconomy();

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigation
    if (!confirm(t('news.article_card.delete_confirm'))) return;
    
    try {
      const { error } = await supabase
        .from('news_articles')
        .delete()
        .eq('id', article.id);
        
      if (error) throw error;
      if (onDelete) onDelete();
    } catch (err) {
      console.error('Error deleting article:', err);
      alert(t('news.article_card.delete_failed'));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="bg-surface border border-white/5 rounded-lg overflow-hidden hover:border-primary/50 transition-all duration-300 group"
    >
      <div className="aspect-video overflow-hidden relative">
        <img
          src={article.image_url || 'https://via.placeholder.com/600x400'}
          alt={article.title}
          className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500"
        />
        <div className="absolute top-4 left-4">
          <span className="px-3 py-1 bg-background/80 backdrop-blur-sm text-primary text-xs font-mono rounded-full border border-primary/20">
            {article.category}
          </span>
        </div>
        {developerStatus === 'APPROVED' && (
          <div className="absolute top-4 right-4">
            <button
              onClick={handleDelete}
              className="p-2 bg-red-500/80 backdrop-blur-sm text-white rounded-full hover:bg-red-600 transition-colors shadow-lg z-20"
              title={t('news.article_card.delete_btn_title')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
      <div className="p-6">
        <div className="flex items-center space-x-4 text-xs text-text-secondary mb-3 font-mono">
          <div className="flex items-center">
            <Calendar className="w-3 h-3 mr-1" />
            {new Date(article.published_at).toLocaleDateString()}
          </div>
          <div className="flex items-center">
            <User className="w-3 h-3 mr-1" />
            {article.author}
          </div>
        </div>
        <Link to={`/news/${article.id}`}>
          <h3 className="text-xl font-bold mb-3 hover:text-primary transition-colors line-clamp-2">
            {article.title}
          </h3>
        </Link>
        <p className="text-text-secondary text-sm line-clamp-3 mb-4">
          {article.excerpt}
        </p>
        <Link
          to={`/news/${article.id}`}
          className="inline-block text-primary hover:text-secondary transition-colors text-sm font-mono"
        >
          {t('news.article_card.read_article')} &rarr;
        </Link>
      </div>
    </motion.div>
  );
};

export default ArticleCard;
