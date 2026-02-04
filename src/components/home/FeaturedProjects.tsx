import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Project {
  id: string;
  title: string;
  excerpt: string;
  image_url: string;
  category: string;
}

const FeaturedProjects = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const { data, error } = await supabase
          .from('news_articles')
          .select('id, title, excerpt, image_url, category')
          .eq('category', 'Projects')
          .limit(3)
          .order('published_at', { ascending: false });

        if (error) throw error;
        setProjects(data || []);
      } catch (error) {
        console.error('Error fetching projects:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  if (loading) {
    return (
      <div className="py-20 bg-surface">
        <div className="container mx-auto px-4 text-center">
          <p className="text-text-secondary font-mono">Loading projects...</p>
        </div>
      </div>
    );
  }

  return (
    <section className="py-20 bg-background">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-end mb-12">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold mb-2">
              <span className="text-primary">Featured</span> Projects
            </h2>
            <div className="h-1 w-20 bg-secondary rounded-full" />
          </div>
          <Link 
            to="/news" 
            className="hidden md:flex items-center text-text-secondary hover:text-primary transition-colors font-mono"
          >
            View All <ArrowRight className="ml-2 w-4 h-4" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {projects.map((project, index) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.2 }}
              viewport={{ once: true }}
              className="group relative overflow-hidden rounded-lg border border-surface bg-surface hover:border-primary/50 transition-all duration-300"
            >
              <div className="aspect-video overflow-hidden">
                <img
                  src={project.image_url || 'https://via.placeholder.com/600x400'}
                  alt={project.title}
                  className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                  <Link
                    to={`/news/${project.id}`}
                    className="px-6 py-2 bg-primary text-background font-bold rounded-full transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300"
                  >
                    View Case Study
                  </Link>
                </div>
              </div>
              <div className="p-6">
                <span className="text-xs font-mono text-secondary uppercase tracking-wider">
                  {project.category}
                </span>
                <h3 className="text-xl font-bold mt-2 mb-3 group-hover:text-primary transition-colors">
                  {project.title}
                </h3>
                <p className="text-text-secondary text-sm line-clamp-3">
                  {project.excerpt}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-8 text-center md:hidden">
          <Link 
            to="/news" 
            className="inline-flex items-center text-text-secondary hover:text-primary transition-colors font-mono"
          >
            View All <ArrowRight className="ml-2 w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default FeaturedProjects;
