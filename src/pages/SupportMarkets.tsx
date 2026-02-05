import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useEconomy } from '../context/EconomyContext';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { TrendingUp, Shield, Trophy, AlertTriangle, Ticket } from 'lucide-react';
import { TicketMarket } from '../components/economy/TicketMarket';

interface Instrument {
  id: string;
  title: string;
  description: string;
  type: 'BOND' | 'INDEX' | 'MILESTONE';
  risk_level: 'LOW' | 'MID' | 'HIGH';
  yield_rate: number;
  lockup_period_days: number;
}

const SupportMarkets = () => {
  const { user } = useAuth();
  const { enterPosition } = useEconomy();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState<{[key: string]: string}>({});
  const [activeView, setActiveView] = useState<'instruments' | 'tickets'>('instruments');

  useEffect(() => {
    fetchInstruments();
  }, []);

  const fetchInstruments = async () => {
    const { data, error } = await supabase
      .from('support_instruments')
      .select('*')
      .eq('status', 'OPEN');
    
    if (error) console.error(error);
    else setInstruments(data || []);
    setLoading(false);
  };

  const handleSupport = async (instrumentId: string) => {
    const val = parseFloat(amount[instrumentId]);
    if (isNaN(val) || val <= 0) return alert('Invalid amount');
    
    const result = await enterPosition(instrumentId, val);
    if (result.success) {
      alert('Support position entered successfully!');
      setAmount({...amount, [instrumentId]: ''});
    } else {
      alert('Failed: ' + result.message);
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'LOW': return 'text-green-400 border-green-400/30 bg-green-400/10';
      case 'MID': return 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10';
      case 'HIGH': return 'text-red-400 border-red-400/30 bg-red-400/10';
      default: return 'text-white';
    }
  };

  if (loading) return <div className="pt-24 text-center text-white">Loading Markets...</div>;

  return (
    <div className="min-h-screen bg-background pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-bold font-mono text-white mb-4">Support Markets</h1>
          <p className="text-text-secondary max-w-2xl mx-auto mb-6">
            Show your support for project milestones and contributors. 
            <br />
            <span className="text-xs text-yellow-500 flex items-center justify-center mt-2">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Not real financial instruments. For community engagement only.
            </span>
          </p>

          <div className="flex justify-center space-x-4 border-b border-white/10 pb-1">
            <button
              onClick={() => setActiveView('instruments')}
              className={`px-6 py-2 font-mono flex items-center ${activeView === 'instruments' ? 'text-primary border-b-2 border-primary' : 'text-text-secondary hover:text-white'}`}
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Instruments
            </button>
            <button
              onClick={() => setActiveView('tickets')}
              className={`px-6 py-2 font-mono flex items-center ${activeView === 'tickets' ? 'text-primary border-b-2 border-primary' : 'text-text-secondary hover:text-white'}`}
            >
              <Ticket className="w-4 h-4 mr-2" />
              Mission Tickets
            </button>
          </div>
        </div>

        {activeView === 'instruments' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {instruments.map((instrument) => (
              <motion.div
                key={instrument.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-surface border border-white/10 rounded-lg p-6 flex flex-col"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className={`text-xs font-bold font-mono px-2 py-1 rounded border ${getRiskColor(instrument.risk_level)}`}>
                    {instrument.risk_level} RISK
                  </span>
                  <span className="text-xs font-mono text-text-secondary">
                    {instrument.type}
                  </span>
                </div>

                <h3 className="text-xl font-bold text-white font-mono mb-2">{instrument.title}</h3>
                <p className="text-text-secondary text-sm mb-6 flex-grow">{instrument.description}</p>

                <div className="bg-background/50 rounded p-4 mb-6 space-y-2 text-sm font-mono">
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Yield:</span>
                    <span className="text-green-400">+{instrument.yield_rate}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Lockup:</span>
                    <span className="text-white">{instrument.lockup_period_days} Days</span>
                  </div>
                </div>

                <div className="mt-auto">
                  <div className="flex space-x-2 mb-2">
                    <input
                      type="number"
                      placeholder="Amount"
                      className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white font-mono text-sm focus:border-primary outline-none"
                      value={amount[instrument.id] || ''}
                      onChange={(e) => setAmount({...amount, [instrument.id]: e.target.value})}
                    />
                  </div>
                  <button
                    onClick={() => handleSupport(instrument.id)}
                    className="w-full bg-primary/20 hover:bg-primary/30 text-primary border border-primary/50 py-2 rounded font-mono font-bold transition-colors"
                  >
                    ENTER POSITION
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <TicketMarket />
        )}
      </div>
    </div>
  );
};

export default SupportMarkets;
