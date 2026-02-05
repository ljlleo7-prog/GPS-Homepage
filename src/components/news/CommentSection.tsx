import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useEconomy } from '../../context/EconomyContext';
import { supabase } from '../../lib/supabase';
import { Trash2, Send } from 'lucide-react';

interface Comment {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  user: {
    username: string;
    avatar_url: string | null;
  } | null; // Joined data might be null if user deleted
}

interface CommentSectionProps {
  newsId: string;
}

const CommentSection = ({ newsId }: CommentSectionProps) => {
  const { user } = useAuth();
  const { developerStatus } = useEconomy();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchComments();
  }, [newsId]);

  const fetchComments = async () => {
    try {
      // Fetch comments with user profile data
      // Note: We need to join with profiles. 
      // Assuming 'profiles' table has 'username' and 'avatar_url' and 'id' matches auth.users.id
      const { data, error } = await supabase
        .from('news_comments')
        .select(`
          id,
          content,
          created_at,
          user_id,
          user:profiles!user_id (
            username,
            avatar_url
          )
        `)
        .eq('news_id', newsId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform data to match interface if needed (Supabase returns array for joined relation if 1-many, but here it's 1-1 per comment)
      // Actually profiles is 1-1 with users.
      // The type return might need casting or handling array vs object.
      // safely handle the join
      const formattedComments = (data || []).map((c: any) => ({
        ...c,
        user: Array.isArray(c.user) ? c.user[0] : c.user
      }));

      setComments(formattedComments);
    } catch (error) {
      console.error('Error fetching comments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newComment.trim()) return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('news_comments')
        .insert({
          news_id: newsId,
          user_id: user.id,
          content: newComment.trim()
        });

      if (error) throw error;

      setNewComment('');
      fetchComments(); // Refresh list
    } catch (error) {
      console.error('Error posting comment:', error);
      alert('Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm('Are you sure you want to delete this comment?')) return;

    try {
      const { error } = await supabase
        .from('news_comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;
      
      setComments(comments.filter(c => c.id !== commentId));
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert('Failed to delete comment');
    }
  };

  if (loading) return <div className="py-4 text-center">Loading comments...</div>;

  return (
    <div className="mt-12 pt-8 border-t border-white/10">
      <h3 className="text-2xl font-bold mb-6">Comments ({comments.length})</h3>

      {/* Comment Form */}
      {user ? (
        <form onSubmit={handleSubmit} className="mb-8">
          <div className="flex gap-4">
            <div className="flex-1">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Share your thoughts..."
                className="w-full bg-surface border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-primary min-h-[100px]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !newComment.trim()}
              className="px-6 py-2 bg-primary text-background font-bold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed h-fit flex items-center"
            >
              <Send className="w-4 h-4 mr-2" />
              Post
            </button>
          </div>
        </form>
      ) : (
        <div className="bg-surface/50 p-4 rounded-lg mb-8 text-center text-text-secondary">
          Please <a href="/login" className="text-primary hover:underline">log in</a> to leave a comment.
        </div>
      )}

      {/* Comments List */}
      <div className="space-y-6">
        {comments.length === 0 ? (
          <p className="text-text-secondary text-center italic">No comments yet. Be the first to share your thoughts!</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="bg-surface border border-white/5 rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                    {comment.user?.avatar_url ? (
                      <img src={comment.user.avatar_url} alt={comment.user.username} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      (comment.user?.username || '?').charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <span className="font-bold text-white block">
                      {comment.user?.username || 'Unknown User'}
                    </span>
                    <span className="text-xs text-text-secondary">
                      {new Date(comment.created_at).toLocaleDateString()} {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                
                {/* Delete Button (Author or Developer) */}
                {(user?.id === comment.user_id || developerStatus === 'APPROVED') && (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="text-text-secondary hover:text-red-500 transition-colors"
                    title="Delete comment"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-text-secondary pl-11 whitespace-pre-wrap">{comment.content}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CommentSection;
