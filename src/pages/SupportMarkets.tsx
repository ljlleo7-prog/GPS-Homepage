import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useEconomy } from '../context/EconomyContext';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, Shield, Trophy, AlertTriangle, Ticket, Plus } from 'lucide-react';
import { TicketMarket } from '../components/economy/TicketMarket';
import { useTranslation } from 'react-i18next';

interface Instrument {
  id: string;
  title: string;
  description: string;
  type: 'BOND' | 'INDEX' | 'MILESTONE';
  risk_level: 'LOW' | 'MID' | 'HIGH';
  yield_rate: number;
  lockup_period_days: number;
  creator_id?: string;
}

const SupportMarkets = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { wallet, enterPosition, createUserCampaign } = useEconomy();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [userPositions, setUserPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState<{[key: string]: string}>({});
  const [activeView, setActiveView] = useState<'instruments' | 'tickets'>('instruments');

  // Create Campaign Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newYield, setNewYield] = useState('');
  const [newLockup, setNewLockup] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchInstruments();
    if (user) fetchPositions();
  }, [user]);

  const fetchPositions = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('support_positions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'ACTIVE');
    
    if (error) console.error('Error fetching positions:', error);
    else setUserPositions(data || []);
  };

  const fetchInstruments = async () => {
    const { data, error } = await supabase
      .from('support_instruments')
      .select('*')
      .in('status', ['OPEN', 'PENDING']); // Show PENDING too? Maybe separate section? For now show all.
    
    if (error) console.error(error);
    else setInstruments(data || []);
    setLoading(false);
  };

  const handleSupport = async (instrumentId: string) => {
    // Rep Gating > 50
    if (!wallet || wallet.reputation_balance <= 50) {
      alert(t('economy.market.instrument.low_rep'));
      return;
    }

    const val = parseFloat(amount[instrumentId]);
    if (isNaN(val) || val <= 0) return alert('Invalid amount');
    
    const result = await enterPosition(instrumentId, val);
    if (result.success) {
      alert('Support position entered successfully!');
      setAmount({...amount, [instrumentId]: ''});
      fetchPositions(); // Refresh positions
    } else {
      alert('Failed: ' + result.message);
    }
  };

  const handleCreateCampaign = async () => {
    if (!newTitle || !newDesc || !newYield || !newLockup) return;
    setCreating(true);
    const result = await createUserCampaign(
      'MARKET',
      newTitle,
      newDesc,
      0, 0,
      parseFloat(newYield),
      parseInt(newLockup)
    );

    if (result.success) {
      alert('Campaign created! Pending approval.');
      setShowCreateModal(false);
      setNewTitle('');
      setNewDesc('');
      setNewYield('');
      setNewLockup('');
      fetchInstruments();
    } else {
      alert(result.message);
    }
    setCreating(false);
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'LOW': return 'text-green-400 border-green-400/30 bg-green-400/10';
      case 'MID': return 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10';
      case 'HIGH': return 'text-red-400 border-red-400/30 bg-red-400/10';
      default: return 'text-white';
    }
  };

  if (loading) return <div className="pt-24 text-center text-white">{t('economy.missions.loading')}</div>;

  return (
    <div className="min-h-screen bg-background pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12 text-center relative">
          <h1 className="text-3xl font-bold font-mono text-white mb-4">{t('economy.market.title')}</h1>
          <p className="text-text-secondary max-w-2xl mx-auto mb-6">
            {t('economy.market.subtitle')}
            <br />
            <span className="text-xs text-yellow-500 flex items-center justify-center mt-2">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {t('economy.market.disclaimer')}
            </span>
          </p>

          <div className="flex justify-center space-x-4 border-b border-white/10 pb-1">
            <button
              onClick={() => setActiveView('instruments')}
              className={`px-6 py-2 font-mono flex items-center ${activeView === 'instruments' ? 'text-primary border-b-2 border-primary' : 'text-text-secondary hover:text-white'}`}
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              {t('economy.market.tabs.instruments')}
            </button>
            <button
              onClick={() => setActiveView('tickets')}
              className={`px-6 py-2 font-mono flex items-center ${activeView === 'tickets' ? 'text-primary border-b-2 border-primary' : 'text-text-secondary hover:text-white'}`}
            >
              <Ticket className="w-4 h-4 mr-2" />
              {t('economy.market.tabs.tickets')}
            </button>
          </div>

          {/* Create Campaign Button */}
          {wallet && wallet.reputation_balance > 70 && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="absolute right-0 top-0 hidden md:flex items-center gap-2 bg-primary/20 text-primary border border-primary/50 px-4 py-2 rounded hover:bg-primary/30 transition-colors"
            >
              <Plus size={16} />
              {t('economy.market.campaign.create_btn')}
            </button>
          )}
        </div>

        {/* Mobile Create Button */}
        {wallet && wallet.reputation_balance > 70 && (
          <div className="md:hidden mb-6 flex justify-center">
             <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-primary/20 text-primary border border-primary/50 px-4 py-2 rounded hover:bg-primary/30 transition-colors"
            >
              <Plus size={16} />
              {t('economy.market.campaign.create_btn')}
            </button>
          </div>
        )}

        {activeView === 'instruments' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {instruments.map((instrument) => {
              const userPosition = userPositions.find(p => p.instrument_id === instrument.id);
              const isInvested = !!userPosition;
              
              return (
              <motion.div 
                key={instrument.id} 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                className={`bg-surface border rounded-lg p-6 flex flex-col relative overflow-hidden ${isInvested ? 'border-primary shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-white/10'}`}
              >
                {isInvested && (
                  <div className="absolute top-0 right-0 bg-primary text-background text-xs font-bold px-3 py-1 rounded-bl-lg z-10">
                    INVESTED
                  </div>
                )}
                
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold text-white font-mono">{instrument.title}</h3>
                  <span className={`text-xs px-2 py-1 rounded font-mono border ${getRiskColor(instrument.risk_level)}`}>
                    {instrument.risk_level} RISK
                  </span>
                </div>
                <p className="text-text-secondary text-sm mb-6 flex-grow">{instrument.description}</p>
                
                <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                  <div className="bg-background/50 p-2 rounded">
                    <div className="text-text-secondary text-xs">{t('economy.market.instrument.yield')}</div>
                    <div className="text-green-400 font-mono">+{instrument.yield_rate}%</div>
                  </div>
                  <div className="bg-background/50 p-2 rounded">
                    <div className="text-text-secondary text-xs">{t('economy.market.instrument.lockup')}</div>
                    <div className="text-white font-mono">{instrument.lockup_period_days} {t('economy.market.instrument.days')}</div>
                  </div>
                </div>

                {isInvested && (
                  <div className="mb-4 bg-primary/10 border border-primary/30 rounded p-3">
                    <div className="text-primary text-xs mb-1">Your Position</div>
                    <div className="text-white font-mono font-bold">{userPosition.amount_invested} Tokens</div>
                  </div>
                )}

                <div className="flex space-x-2">
                  <input
                    type="number"
                    placeholder={t('economy.market.instrument.amount_placeholder')}
                    className="flex-1 bg-background border border-white/10 rounded px-3 py-2 text-white font-mono text-sm"
                    value={amount[instrument.id] || ''}
                    onChange={(e) => setAmount({...amount, [instrument.id]: e.target.value})}
                  />
                  <button
                    onClick={() => handleSupport(instrument.id)}
                    className="bg-primary text-background font-bold px-4 py-2 rounded hover:bg-primary/90 transition-colors text-sm font-mono"
                  >
                    {t('economy.market.instrument.support_btn')}
                  </button>
                </div>
              </motion.div>
            )})}
          </div>
        ) : (
          <TicketMarket />
        )}
      </div>

      {/* Create Campaign Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface border border-white/20 rounded-lg p-6 max-w-md w-full"
            >
              <h3 className="text-xl font-bold text-white mb-4">{t('economy.market.campaign.modal_title')}</h3>
              <div className="space-y-4 mb-4">
                <div>
                  <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.title_label')}</label>
                  <input
                    type="text"
                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.desc_label')}</label>
                  <textarea
                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                    rows={3}
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.yield_label')}</label>
                    <input
                      type="number"
                      className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                      value={newYield}
                      onChange={(e) => setNewYield(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.lockup_label')}</label>
                    <input
                      type="number"
                      className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                      value={newLockup}
                      onChange={(e) => setNewLockup(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-white/10 text-white py-2 rounded hover:bg-white/20"
                >
                  {t('economy.missions.create_modal.cancel')}
                </button>
                <button
                  onClick={handleCreateCampaign}
                  disabled={creating}
                  className="flex-1 bg-primary text-background font-bold py-2 rounded hover:bg-primary/90"
                >
                  {creating ? 'Creating...' : t('economy.market.campaign.submit')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SupportMarkets;
