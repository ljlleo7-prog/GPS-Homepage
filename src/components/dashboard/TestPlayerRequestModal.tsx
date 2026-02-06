import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Gamepad2, Send } from 'lucide-react';
import { useEconomy } from '../../context/EconomyContext';

interface TestPlayerRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PROGRAMS = ['Skyline Tragedy', 'DeltaDash'];

const TestPlayerRequestModal = ({ isOpen, onClose }: TestPlayerRequestModalProps) => {
  const { requestTestPlayerAccess } = useEconomy();
  const [identifiableName, setIdentifiableName] = useState('');
  const [program, setProgram] = useState(PROGRAMS[0]);
  const [progress, setProgress] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await requestTestPlayerAccess(identifiableName, program, progress);
      if (result.success) {
        alert('Request submitted successfully!');
        onClose();
        setIdentifiableName('');
        setProgress('');
      } else {
        alert(result.message || 'Failed to submit request');
      }
    } catch (error) {
      console.error(error);
      alert('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-surface border border-white/10 rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
        >
          <div className="p-6 border-b border-white/10 flex justify-between items-center">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Gamepad2 className="text-primary" />
              Request Test Player Access
            </h2>
            <button onClick={onClose} className="text-text-secondary hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3 text-xs text-blue-200 mb-4">
              Approved testers receive +20 Reputation and free access to the selected program.
            </div>

            <div>
              <label className="block text-sm font-mono text-text-secondary mb-1">Identifiable Name</label>
              <input
                type="text"
                required
                value={identifiableName}
                onChange={(e) => setIdentifiableName(e.target.value)}
                placeholder="e.g. WeChat Nickname"
                className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:border-primary focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-mono text-text-secondary mb-1">Test Program</label>
              <select
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:border-primary focus:outline-none transition-colors"
              >
                {PROGRAMS.map(p => (
                  <option key={p} value={p} className="bg-surface">{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-mono text-text-secondary mb-1">Current Progress</label>
              <textarea
                required
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
                placeholder="Briefly describe your current progress or why you want to test..."
                rows={3}
                className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-white focus:border-primary focus:outline-none transition-colors resize-none"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary/90 text-background font-bold py-2 px-4 rounded transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-background border-t-transparent"></span>
                ) : (
                  <>
                    <Send size={16} />
                    Submit Request
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default TestPlayerRequestModal;
