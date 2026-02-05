import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useEconomy } from '../context/EconomyContext';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Plus, Award, X, Star, User, Heart, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ForumPost {
  id: string;
  title: string;
  content: string;
  author_id: string;
  is_featured: boolean;
  reward_amount: number;
  created_at: string;
  profiles: {
    username: string;
    avatar_url: string | null;
    developer_status: string;
  };
  likes_count: number;
  comments_count: number;
  user_has_liked: boolean;
}

interface Comment {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  profiles: {
    username: string;
    avatar_url: string | null;
    developer_status: string;
  };
}

const Forum = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { wallet, developerStatus, refreshEconomy } = useEconomy();
  
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Create Post State
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);

  // Reward State
  const [selectedPost, setSelectedPost] = useState<ForumPost | null>(null);
  const [rewardAmount, setRewardAmount] = useState('10');
  const [rewarding, setRewarding] = useState(false);

  // Comments State
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    fetchPosts();
  }, [user]);

  const fetchPosts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('forum_posts')
        .select(`
          *,
          profiles (username, avatar_url, developer_status),
          forum_likes (user_id),
          forum_comments (id)
        `)
        .order('is_featured', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedPosts = data?.map((post: any) => ({
        ...post,
        likes_count: post.forum_likes?.length || 0,
        comments_count: post.forum_comments?.length || 0,
        user_has_liked: user ? post.forum_likes?.some((like: any) => like.user_id === user.id) : false
      })) || [];

      setPosts(formattedPosts);
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async (postId: string) => {
    setLoadingComments(true);
    try {
      const { data, error } = await supabase
        .from('forum_comments')
        .select(`
          *,
          profiles (username, avatar_url, developer_status)
        `)
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      
      if (error) throw error;
      setComments(data || []);
    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      setLoadingComments(false);
    }
  };

  const handleToggleLike = async (post: ForumPost) => {
    if (!user) return;
    
    // Optimistic update
    const isLiked = post.user_has_liked;
    setPosts(posts.map(p => p.id === post.id ? {
      ...p,
      user_has_liked: !isLiked,
      likes_count: isLiked ? p.likes_count - 1 : p.likes_count + 1
    } : p));

    try {
      if (isLiked) {
        await supabase.from('forum_likes').delete().eq('post_id', post.id).eq('user_id', user.id);
      } else {
        await supabase.from('forum_likes').insert({ post_id: post.id, user_id: user.id });
      }
    } catch (error) {
      console.error('Error toggling like:', error);
      fetchPosts(); // Revert on error
    }
  };

  const handleExpandComments = (postId: string) => {
    if (expandedPostId === postId) {
      setExpandedPostId(null);
    } else {
      setExpandedPostId(postId);
      fetchComments(postId);
    }
  };

  const handleSubmitComment = async (postId: string) => {
    if (!user || !newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const { error } = await supabase.from('forum_comments').insert({
        post_id: postId,
        user_id: user.id,
        content: newComment
      });
      if (error) throw error;
      setNewComment('');
      fetchComments(postId);
      // Update comment count locally
      setPosts(posts.map(p => p.id === postId ? { ...p, comments_count: p.comments_count + 1 } : p));
    } catch (error) {
      console.error('Error commenting:', error);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleCreate = async () => {
    if (!wallet || wallet.reputation_balance < 50) {
      alert(t('forum.low_rep_error'));
      return;
    }
    if (!newTitle.trim() || !newContent.trim()) return;

    setCreating(true);
    try {
      const { error } = await supabase
        .from('forum_posts')
        .insert({
          title: newTitle,
          content: newContent,
          author_id: user?.id
        });

      if (error) throw error;

      setShowCreate(false);
      setNewTitle('');
      setNewContent('');
      fetchPosts();
    } catch (error) {
      console.error('Error creating post:', error);
      alert('Failed to create post');
    } finally {
      setCreating(false);
    }
  };

  const handleReward = async () => {
    if (!selectedPost || !rewardAmount) return;
    
    setRewarding(true);
    try {
      const { data, error } = await supabase.rpc('acknowledge_forum_post', {
        p_post_id: selectedPost.id,
        p_amount: parseFloat(rewardAmount)
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.message);

      alert('Post acknowledged successfully!');
      setSelectedPost(null);
      setRewardAmount('10');
      fetchPosts();
      refreshEconomy(); 
    } catch (error: any) {
      console.error('Error rewarding post:', error);
      alert('Failed to reward post: ' + (error.message || 'Unknown error'));
    } finally {
      setRewarding(false);
    }
  };

  return (
    <div className="min-h-screen pt-20 pb-12 bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-8">
          <div className="mb-4 md:mb-0">
            <h1 className="text-3xl font-mono font-bold text-white mb-2">
              <span className="text-primary">&gt;</span> {t('forum.title')}
            </h1>
            <p className="text-text-secondary font-mono">
              {t('forum.subtitle')}
            </p>
          </div>
          
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center px-4 py-2 bg-primary/10 border border-primary text-primary rounded hover:bg-primary hover:text-background transition-all font-mono"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('forum.create_post')}
          </button>
        </div>

        {/* Post List */}
        <div className="grid gap-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-text-secondary font-mono">Loading discussions...</p>
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-12 bg-surface border border-white/5 rounded-lg">
              <MessageSquare className="w-12 h-12 text-text-secondary mx-auto mb-4 opacity-50" />
              <p className="text-text-secondary font-mono">No posts yet. Be the first!</p>
            </div>
          ) : (
            posts.map((post) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-surface border ${post.is_featured ? 'border-secondary/50 shadow-[0_0_10px_rgba(57,255,20,0.1)]' : 'border-white/5'} rounded-lg p-6 hover:border-primary/30 transition-colors`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      {post.is_featured && (
                        <span className="px-2 py-0.5 bg-secondary/20 text-secondary text-xs font-mono rounded border border-secondary/30 flex items-center">
                          <Star className="w-3 h-3 mr-1" />
                          {t('forum.featured')}
                        </span>
                      )}
                      <h3 className="text-xl font-bold text-white">{post.title}</h3>
                    </div>
                    <div className="flex items-center text-sm text-text-secondary space-x-4">
                      <div className="flex items-center">
                        <User className="w-4 h-4 mr-1" />
                        <span className={post.profiles?.developer_status === 'APPROVED' ? 'text-cyan-400' : ''}>{post.profiles?.username || 'Unknown'}</span>
                      </div>
                      <span>{new Date(post.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  
                  {post.reward_amount > 0 && (
                    <div className="flex items-center text-secondary font-mono bg-secondary/10 px-3 py-1 rounded-full">
                      <Award className="w-4 h-4 mr-2" />
                      +{post.reward_amount} Tokens
                    </div>
                  )}
                </div>

                <p className="text-text-secondary mb-6 whitespace-pre-wrap">{post.content}</p>

                {/* Actions Bar */}
                <div className="flex items-center space-x-6 border-t border-white/5 pt-4">
                  <button
                    onClick={() => handleToggleLike(post)}
                    className={`flex items-center space-x-2 transition-colors ${
                      post.user_has_liked ? 'text-red-500' : 'text-text-secondary hover:text-red-500'
                    }`}
                  >
                    <Heart className={`w-5 h-5 ${post.user_has_liked ? 'fill-current' : ''}`} />
                    <span className="font-mono text-sm">{post.likes_count}</span>
                  </button>

                  <button
                    onClick={() => handleExpandComments(post.id)}
                    className="flex items-center space-x-2 text-text-secondary hover:text-primary transition-colors"
                  >
                    <MessageCircle className="w-5 h-5" />
                    <span className="font-mono text-sm">{post.comments_count} Comments</span>
                  </button>

                  {/* Admin Actions */}
                  {developerStatus === 'APPROVED' && (
                    <button
                      onClick={() => setSelectedPost(post)}
                      className="text-sm font-mono text-cyan-400 hover:text-cyan-300 transition-colors flex items-center ml-auto"
                    >
                      <Award className="w-4 h-4 mr-1" />
                      Acknowledge
                    </button>
                  )}
                </div>

                {/* Comments Section */}
                <AnimatePresence>
                  {expandedPostId === post.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 pt-4 border-t border-white/5 bg-black/20 -mx-6 px-6 pb-4">
                        <h4 className="font-mono text-sm text-text-secondary mb-4">Comments</h4>
                        
                        {loadingComments ? (
                          <div className="text-center py-4">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mx-auto"></div>
                          </div>
                        ) : comments.length === 0 ? (
                          <p className="text-sm text-text-secondary italic mb-4">No comments yet.</p>
                        ) : (
                          <div className="space-y-4 mb-6">
                            {comments.map((comment) => (
                              <div key={comment.id} className="flex space-x-3">
                                <div className="flex-shrink-0">
                                  <div className="w-8 h-8 rounded-full bg-surface border border-white/10 flex items-center justify-center">
                                    <span className="font-mono text-xs text-primary">{comment.profiles?.username?.[0] || '?'}</span>
                                  </div>
                                </div>
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <span className={`font-bold text-sm ${comment.profiles?.developer_status === 'APPROVED' ? 'text-cyan-400' : 'text-white'}`}>
                                      {comment.profiles?.username || 'Unknown'}
                                    </span>
                                    <span className="text-xs text-text-secondary">
                                      {new Date(comment.created_at).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <p className="text-sm text-text-secondary mt-1">{comment.content}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Add Comment */}
                        {user ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newComment}
                              onChange={(e) => setNewComment(e.target.value)}
                              placeholder="Write a comment..."
                              className="flex-1 bg-surface border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary transition-colors"
                              onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment(post.id)}
                            />
                            <button
                              onClick={() => handleSubmitComment(post.id)}
                              disabled={submittingComment || !newComment.trim()}
                              className="bg-primary/20 text-primary hover:bg-primary hover:text-white px-3 py-2 rounded transition-colors disabled:opacity-50"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-text-secondary text-center">Log in to comment</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))
          )}
        </div>

        {/* Create Modal */}
        <AnimatePresence>
          {showCreate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface border border-white/10 rounded-lg max-w-lg w-full p-6 shadow-2xl"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-mono font-bold text-white">{t('forum.create_post')}</h2>
                  <button onClick={() => setShowCreate(false)} className="text-text-secondary hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-mono text-text-secondary mb-2">{t('forum.title_label')}</label>
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="w-full bg-background border border-white/10 rounded px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                      placeholder="Enter title..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-mono text-text-secondary mb-2">{t('forum.content_label')}</label>
                    <textarea
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      className="w-full bg-background border border-white/10 rounded px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors h-32 resize-none"
                      placeholder="Share your thoughts..."
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-4 mt-6">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2 text-text-secondary hover:text-white font-mono transition-colors"
                  >
                    {t('forum.cancel')}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="px-6 py-2 bg-primary text-background font-mono font-bold rounded hover:bg-primary-dark transition-colors disabled:opacity-50"
                  >
                    {creating ? 'Posting...' : t('forum.submit')}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Reward Modal */}
        <AnimatePresence>
          {selectedPost && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface border border-white/10 rounded-lg max-w-sm w-full p-6 shadow-2xl"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-mono font-bold text-white">{t('forum.reward_action')}</h2>
                  <button onClick={() => setSelectedPost(null)} className="text-text-secondary hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <p className="text-sm text-text-secondary mb-4">
                  Reward <strong>{selectedPost.title}</strong> by {selectedPost.profiles?.username}
                </p>

                <div className="mb-6">
                  <label className="block text-sm font-mono text-text-secondary mb-2">Reward Amount (Tokens)</label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="1"
                      max="1000"
                      step="1"
                      value={rewardAmount}
                      onChange={(e) => setRewardAmount(e.target.value)}
                      className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
                    />
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={rewardAmount}
                      onChange={(e) => setRewardAmount(e.target.value)}
                      className="w-20 bg-background border border-white/10 rounded px-2 py-1 text-white text-center focus:outline-none focus:border-secondary transition-colors"
                    />
                  </div>
                  <div className="flex justify-between text-xs text-text-secondary mt-2 font-mono">
                    <span>1 Token</span>
                    <span>1000 Tokens</span>
                  </div>
                </div>

                <div className="flex justify-end space-x-4">
                  <button
                    onClick={() => setSelectedPost(null)}
                    className="px-4 py-2 text-text-secondary hover:text-white font-mono transition-colors"
                  >
                    {t('forum.cancel')}
                  </button>
                  <button
                    onClick={handleReward}
                    disabled={rewarding}
                    className="px-6 py-2 bg-secondary text-background font-mono font-bold rounded hover:bg-secondary-dark transition-colors disabled:opacity-50"
                  >
                    {rewarding ? 'Processing...' : t('forum.confirm_reward')}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};

export default Forum;
