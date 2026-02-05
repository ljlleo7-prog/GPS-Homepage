import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, User, ArrowLeft, Tag } from 'lucide-react';
import { supabase } from '../lib/supabase';
import CommentSection from '../components/news/CommentSection';

interface Article {
  id: string;
  title: string;
  content: string;
  image_url: string;
  category: string;
  published_at: string;
  author: string;
}

const ArticleDetails = () => {
  const { id } = useParams<{ id: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticle = async () => {
      if (!id) return;

      try {
        const { data, error } = await supabase
          .from('news_articles')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        setArticle(data);
      } catch (error) {
        console.error('Error fetching article:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchArticle();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
        <h2 className="text-2xl font-bold mb-4">Article not found</h2>
        <Link to="/news" className="text-primary hover:text-secondary transition-colors">
          Return to News
        </Link>
      </div>
    );
  }

  return (
    <article className="min-h-screen bg-background pb-20">
      {/* Hero Image */}
      <div className="h-[40vh] md:h-[50vh] relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background z-10" />
        <img
          src={article.image_url || 'https://via.placeholder.com/1200x600'}
          alt={article.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute top-8 left-4 z-20 container mx-auto px-4">
          <Link 
            to="/news" 
            className="inline-flex items-center text-white/80 hover:text-primary transition-colors bg-black/30 px-4 py-2 rounded-full backdrop-blur-sm"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to News
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 -mt-20 relative z-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-4xl mx-auto bg-surface border border-white/5 rounded-xl p-8 md:p-12 shadow-2xl"
        >
          <div className="flex flex-wrap gap-4 mb-6">
            <span className="flex items-center text-primary font-mono text-sm px-3 py-1 bg-primary/10 rounded-full border border-primary/20">
              <Tag className="w-3 h-3 mr-2" />
              {article.category}
            </span>
            <span className="flex items-center text-text-secondary font-mono text-sm">
              <Calendar className="w-3 h-3 mr-2" />
              {new Date(article.published_at).toLocaleDateString()}
            </span>
            <span className="flex items-center text-text-secondary font-mono text-sm">
              <User className="w-3 h-3 mr-2" />
              {article.author}
            </span>
          </div>

          <h1 className="text-3xl md:text-5xl font-bold mb-8 leading-tight">
            {article.title}
          </h1>

          <div className="prose prose-invert prose-lg max-w-none">
            {article.content.split('\n').map((paragraph, index) => (
              <p key={index} className="mb-4 text-text-secondary leading-relaxed">
                {paragraph}
              </p>
            ))}
          </div>

          <CommentSection newsId={article.id} />
        </motion.div>
      </div>
    </article>
  );
};

export default ArticleDetails;
