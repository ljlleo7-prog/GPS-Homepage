import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  photo_url: string;
  display_order: number;
}

const TeamGrid = () => {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTeam = async () => {
      try {
        const { data, error } = await supabase
          .from('team_members')
          .select('*')
          .order('display_order', { ascending: true });

        if (error) throw error;
        setTeam(data || []);
      } catch (error) {
        console.error('Error fetching team:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTeam();
  }, []);

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
      {team.map((member, index) => (
        <motion.div
          key={member.id}
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.1 }}
          viewport={{ once: true }}
          className="bg-surface border border-white/5 rounded-lg p-6 text-center hover:border-primary/50 transition-all duration-300 group"
        >
          <div className="w-32 h-32 mx-auto mb-6 rounded-full overflow-hidden border-2 border-secondary p-1 group-hover:shadow-[0_0_20px_rgba(57,255,20,0.3)] transition-all duration-300">
            <img
              src={member.photo_url || 'https://via.placeholder.com/150'}
              alt={member.name}
              className="w-full h-full rounded-full object-cover"
            />
          </div>
          <h3 className="text-xl font-bold mb-1">{member.name}</h3>
          <p className="text-primary font-mono text-sm mb-4">{member.role}</p>
          <p className="text-text-secondary text-sm">
            {member.bio}
          </p>
        </motion.div>
      ))}
    </div>
  );
};

export default TeamGrid;
