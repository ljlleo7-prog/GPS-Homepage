import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useEconomy } from '../context/EconomyContext';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, Shield, Trophy, AlertTriangle, Ticket, Plus, Trash2, XCircle } from 'lucide-react';
import { TicketMarket } from '../components/economy/TicketMarket';
import { useTranslation } from 'react-i18next';

interface RefundItem {
  date: string;
  amount: number;
}

interface Instrument {
  id: string;
  title: string;
  description: string;
  type: 'BOND' | 'INDEX' | 'MILESTONE' | 'MARKET';
  risk_level: 'LOW' | 'MID' | 'HIGH';
  yield_rate: number;
  lockup_period_days: number;
  creator_id?: string;
  ticket_type_id?: string;
  refund_schedule?: RefundItem[];
  is_driver_bet?: boolean;
  deletion_status?: 'NONE' | 'DELISTED_MARKET' | 'DELETED_EVERYWHERE';
}

const SupportMarkets = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { wallet, enterPosition, createUserCampaign, deleteCampaign } = useEconomy();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [userPositions, setUserPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState<{[key: string]: string}>({});
  const [activeView, setActiveView] = useState<'instruments' | 'tickets'>('instruments');

  // Create Campaign Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isDriverBet, setIsDriverBet] = useState(false);
  const [refundSchedule, setRefundSchedule] = useState<RefundItem[]>([]);
  const [tempRefundDate, setTempRefundDate] = useState('');
  const [tempRefundAmount, setTempRefundAmount] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchInstruments();
    if (user) fetchPositions();
  }, [user, activeView]);

  const fetchPositions = async () => {
    if (!user) return;
    // For ticket based campaigns, position is in user_ticket_balances. 
    // But we might still have legacy positions in support_positions.
    // Let's fetch ticket balances for now if we want to show invested status.
    // Or we can rely on `wallet` or separate fetch.
    // The previous implementation used `support_positions`. 
    // The new system uses tickets. 
    // Let's fetch tickets for highlighting invested status.
    
    const { data: tickets, error } = await supabase
      .from('user_ticket_balances')
      .select('*')
      .eq('user_id', user.id)
      .gt('balance', 0);

    if (error) console.error('Error fetching tickets:', error);
    else {
        // Map tickets to instrument IDs if possible. 
        // We need to know which ticket type belongs to which instrument.
        // We can do this by matching ticket_type_id from instruments.
        setUserPositions(tickets || []);
    }
  };

  const fetchInstruments = async () => {
    const { data, error } = await supabase
      .from('support_instruments')
      .select('*')
      .neq('deletion_status', 'DELETED_EVERYWHERE'); // Hide fully deleted ones
    
    if (error) console.error(error);
    else setInstruments(data || []);
    setLoading(false);
  };

  const handleSupport = async (instrument: Instrument) => {
    // Rep Gating > 50
    if (!wallet || wallet.reputation_balance <= 50) {
      alert(t('economy.market.instrument.low_rep'));
      return;
    }

    const val = parseFloat(amount[instrument.id]);
    if (isNaN(val) || val <= 0) return alert('Invalid amount');
    
    // For tickets, amount must be integer
    if (instrument.ticket_type_id && !Number.isInteger(val)) {
        return alert('Ticket quantity must be an integer');
    }

    const result = await enterPosition(instrument.id, val);
    if (result.success) {
      alert('Tickets purchased successfully!');
      setAmount({...amount, [instrument.id]: ''});
      fetchPositions(); 
    } else {
      alert('Failed: ' + result.message);
    }
  };

  const handleAddRefundItem = () => {
    if (!tempRefundDate || !tempRefundAmount) return;
    setRefundSchedule([...refundSchedule, {
        date: tempRefundDate,
        amount: parseFloat(tempRefundAmount)
    }].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
    setTempRefundDate('');
    setTempRefundAmount('');
  };

  const handleRemoveRefundItem = (index: number) => {
    setRefundSchedule(refundSchedule.filter((_, i) => i !== index));
  };

  const handleCreateCampaign = async () => {
    if (!newTitle || !newDesc) return;
    if (refundSchedule.length === 0) {
        alert("Please add at least one refund schedule item.");
        return;
    }
    setCreating(true);
    const result = await createUserCampaign(
      'MARKET',
      newTitle,
      newDesc,
      0, 0, 0, 0, // Legacy params
      refundSchedule,
      isDriverBet
    );

    if (result.success) {
      alert('Campaign created!');
      setShowCreateModal(false);
      setNewTitle('');
      setNewDesc('');
      setIsDriverBet(false);
      setRefundSchedule([]);
      fetchInstruments();
    } else {
      alert(result.message);
    }
    setCreating(false);
  };

  const handleDelete = async (id: string, mode: 'MARKET' | 'EVERYWHERE') => {
      if (!confirm(`Are you sure you want to delete this campaign ${mode === 'MARKET' ? 'from the market' : 'everywhere'}? This action cannot be undone.`)) return;
      
      const result = await deleteCampaign(id, mode);
      if (result.success) {
          alert('Campaign deleted successfully.');
          fetchInstruments();
      } else {
          alert('Failed to delete: ' + result.message);
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
              // Find if user has tickets for this instrument
              const userTicket = userPositions.find(p => p.ticket_type_id === instrument.ticket_type_id);
              const isInvested = !!userTicket;
              const isCreator = user && instrument.creator_id === user.id;
              const isDelisted = instrument.deletion_status === 'DELISTED_MARKET';
              
              return (
              <motion.div 
                key={instrument.id} 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                className={`bg-surface border rounded-lg p-6 flex flex-col relative overflow-hidden ${isInvested ? 'border-primary shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-white/10'} ${isDelisted ? 'opacity-60' : ''}`}
              >
                {isInvested && (
                  <div className="absolute top-0 right-0 bg-primary text-background text-xs font-bold px-3 py-1 rounded-bl-lg z-10">
                    INVESTED
                  </div>
                )}
                {isDelisted && (
                   <div className="absolute top-0 left-0 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-br-lg z-10">
                     DELISTED
                   </div>
                )}
                
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold text-white font-mono">{instrument.title}</h3>
                  <span className={`text-xs px-2 py-1 rounded font-mono border ${getRiskColor(instrument.risk_level)}`}>
                    {instrument.risk_level} RISK
                  </span>
                </div>
                <p className="text-text-secondary text-sm mb-6 flex-grow">{instrument.description}</p>
                
                {/* Refund Schedule Display */}
                {instrument.refund_schedule && instrument.refund_schedule.length > 0 ? (
                    <div className="mb-4 bg-background/50 p-3 rounded">
                        <div className="text-text-secondary text-xs mb-2">Refund Schedule (per ticket):</div>
                        <div className="space-y-1 max-h-24 overflow-y-auto">
                            {instrument.refund_schedule.map((item, idx) => (
                                <div key={idx} className="flex justify-between text-xs font-mono">
                                    <span className="text-white">{item.date}</span>
                                    <span className="text-green-400">{item.amount} Tokens</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
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
                )}

                {isInvested && (
                  <div className="mb-4 bg-primary/10 border border-primary/30 rounded p-3">
                    <div className="text-primary text-xs mb-1">Your Tickets</div>
                    <div className="text-white font-mono font-bold">{userTicket.balance} Tickets</div>
                  </div>
                )}
                
                {/* Action Area */}
                <div className="mt-auto space-y-3">
                    {!isDelisted && (
                        <div className="flex space-x-2">
                        <input
                            type="number"
                            placeholder="Qty"
                            className="flex-1 bg-background border border-white/10 rounded px-3 py-2 text-white font-mono text-sm"
                            value={amount[instrument.id] || ''}
                            onChange={(e) => setAmount({...amount, [instrument.id]: e.target.value})}
                        />
                        <button
                            onClick={() => handleSupport(instrument)}
                            className="bg-primary text-background font-bold px-4 py-2 rounded hover:bg-primary/90 transition-colors text-sm font-mono whitespace-nowrap"
                        >
                            Buy (1 Tkn)
                        </button>
                        </div>
                    )}

                    {/* Creator Controls */}
                    {isCreator && (
                        <div className="flex space-x-2 pt-2 border-t border-white/10">
                            <button
                                onClick={() => handleDelete(instrument.id, 'MARKET')}
                                className="flex-1 flex items-center justify-center gap-1 bg-yellow-500/20 text-yellow-500 text-xs py-1 rounded hover:bg-yellow-500/30"
                                title="Delist from Market (Trading continues)"
                            >
                                <XCircle size={12} /> Delist
                            </button>
                            <button
                                onClick={() => handleDelete(instrument.id, 'EVERYWHERE')}
                                className="flex-1 flex items-center justify-center gap-1 bg-red-500/20 text-red-500 text-xs py-1 rounded hover:bg-red-500/30"
                                title="Delete Everywhere (Refunds users)"
                            >
                                <Trash2 size={12} /> Delete
                            </button>
                        </div>
                    )}
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
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-surface border border-white/20 rounded-lg p-6 max-w-md w-full my-8"
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
                
                {/* Driver Bet Checkbox */}
                <div className="flex items-center space-x-2 bg-white/5 p-2 rounded">
                    <input 
                        type="checkbox" 
                        id="driverBet" 
                        checked={isDriverBet} 
                        onChange={e => setIsDriverBet(e.target.checked)}
                        className="rounded border-white/10 bg-background"
                    />
                    <label htmlFor="driverBet" className="text-sm text-white">Is this a Driver Bet? (High Risk)</label>
                </div>

                {/* Refund Schedule Builder */}
                <div className="border border-white/10 rounded p-3">
                    <label className="block text-xs text-text-secondary mb-2">Refund Schedule (Per Ticket)</label>
                    
                    <div className="flex gap-2 mb-2">
                        <input 
                            type="date" 
                            className="bg-background border border-white/10 rounded px-2 py-1 text-white text-xs flex-1"
                            value={tempRefundDate}
                            onChange={e => setTempRefundDate(e.target.value)}
                        />
                        <input 
                            type="number" 
                            placeholder="Amt"
                            className="bg-background border border-white/10 rounded px-2 py-1 text-white text-xs w-16"
                            value={tempRefundAmount}
                            onChange={e => setTempRefundAmount(e.target.value)}
                        />
                        <button 
                            onClick={handleAddRefundItem}
                            className="bg-primary/20 text-primary px-2 rounded hover:bg-primary/30"
                        >
                            <Plus size={14} />
                        </button>
                    </div>

                    <div className="space-y-1 max-h-32 overflow-y-auto">
                        {refundSchedule.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-background/50 px-2 py-1 rounded text-xs">
                                <span className="text-white">{item.date}: {item.amount} Tkn</span>
                                <button onClick={() => handleRemoveRefundItem(idx)} className="text-red-400 hover:text-red-300">
                                    <XCircle size={12} />
                                </button>
                            </div>
                        ))}
                        {refundSchedule.length === 0 && <div className="text-text-secondary text-xs italic">No refund items added</div>}
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
