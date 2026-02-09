import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useEconomy } from '../context/EconomyContext';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, AlertTriangle, Ticket, Plus, Trash2, XCircle } from 'lucide-react';
import { TicketMarket } from '../components/economy/TicketMarket';
import { PolicyInfo } from '../components/common/PolicyInfo';
import { useTranslation } from 'react-i18next';

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
  ticket_type_a_id?: string;
  ticket_type_b_id?: string;
  refund_schedule?: any[];
  is_driver_bet?: boolean;
  deletion_status?: 'NONE' | 'DELISTED_MARKET' | 'DELETED_EVERYWHERE';
  side_a_name?: string;
  side_b_name?: string;
  ticket_price?: number;
  ticket_limit?: number;
  official_end_date?: string;
  open_date?: string;
  winning_side?: 'A' | 'B';
  resolution_status?: string;
  deliverable_frequency?: string;
  deliverable_cost_per_ticket?: number;
  deliverable_condition?: string;
  refund_price?: number;
}

const SupportMarkets = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { wallet, enterPosition, createUserCampaign, createDriverBet, buyDriverBetTicket, resolveDriverBet, deleteCampaign, refreshEconomy } = useEconomy();
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
  
  // Standard Campaign State
  
  // Normal Market Deliverable State
  const [riskLevel, setRiskLevel] = useState('HIGH');
  const [deliverableFrequency, setDeliverableFrequency] = useState('MONTHLY');
  const [deliverableDay, setDeliverableDay] = useState('');
  const [deliverableCost, setDeliverableCost] = useState('');
  const [deliverableCondition, setDeliverableCondition] = useState('');
  const [refundPrice, setRefundPrice] = useState('0.9');

  // Driver Bet State
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [ticketPrice, setTicketPrice] = useState('');
  const [ticketLimit, setTicketLimit] = useState('');
  const [endDate, setEndDate] = useState('');
  const [openDate, setOpenDate] = useState('');

  const [creating, setCreating] = useState(false);
  const [viewingHolders, setViewingHolders] = useState<{id: string, side: 'A' | 'B' | 'General'} | null>(null);
  const [holdersList, setHoldersList] = useState<{username: string, balance: number}[]>([]);
  const [driverBetStats, setDriverBetStats] = useState<{[key: string]: {side_a_sold: number, side_b_sold: number}}>({});

  useEffect(() => {
    fetchInstruments();
    fetchDriverBetStats();
    if (user) fetchPositions();
  }, [user, activeView]);

  useEffect(() => {
    if (showCreateModal && wallet && wallet.reputation_balance < 70) {
        setIsDriverBet(true);
    }
  }, [showCreateModal, wallet]);

  const fetchDriverBetStats = async () => {
    const { data, error } = await supabase.rpc('get_driver_bet_stats');
    if (error) console.error('Error fetching bet stats:', error);
    else setDriverBetStats(data || {});
  };

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
      alert(t('economy.market.alerts.low_rep'));
      return;
    }

    const val = parseFloat(amount[instrument.id]);
    if (isNaN(val) || val <= 0) return alert(t('economy.market.alerts.invalid_amount'));
    
    // For tickets, amount must be integer
    if (instrument.ticket_type_id && !Number.isInteger(val)) {
        return alert(t('economy.market.alerts.ticket_integer'));
    }

    const result = await enterPosition(instrument.id, val);
    if (result.success) {
      alert(t('economy.market.alerts.purchase_success'));
      setAmount({...amount, [instrument.id]: ''});
      fetchPositions(); 
    } else {
      alert(t('economy.market.alerts.purchase_failed', { message: result.message }));
    }
  };

  const handleCreateCampaign = async () => {
    if (!newTitle || !newDesc) return;
    
    setCreating(true);

    if (isDriverBet) {
        if (!sideA || !ticketPrice || !ticketLimit || !endDate || !openDate) {
            alert(t('economy.market.alerts.fill_driver_bet'));
            setCreating(false);
            return;
        }

        const result = await createDriverBet(
            newTitle,
            newDesc,
            sideA,
            parseFloat(ticketPrice),
            parseInt(ticketLimit),
            new Date(endDate).toISOString(),
            new Date(openDate).toISOString(),
            sideB
        );

        if (result.success) {
            alert(t('economy.market.alerts.driver_bet_created'));
            setShowCreateModal(false);
            setNewTitle(''); setNewDesc(''); setIsDriverBet(false);
            setSideA(''); setSideB(''); setTicketPrice(''); setTicketLimit(''); setEndDate(''); setOpenDate('');
            fetchInstruments();
        } else {
            alert(result.message);
        }
    } else {
        // Validate new deliverable fields
        if (!riskLevel || !deliverableFrequency || !deliverableDay || !deliverableCost || !deliverableCondition || !refundPrice) {
            alert(t('economy.market.alerts.fill_deliverables'));
            setCreating(false);
            return;
        }

        const result = await createUserCampaign(
          'MARKET',
          newTitle,
          newDesc,
          0, 0, 0, 0, // Legacy params
          [], // Refund schedule ignored
          false,
          riskLevel,
          deliverableFrequency,
          deliverableDay,
          parseFloat(deliverableCost),
          deliverableCondition,
          parseFloat(refundPrice)
        );

        if (result.success) {
          alert(t('economy.market.alerts.campaign_created'));
          setShowCreateModal(false);
          setNewTitle('');
          setNewDesc('');
          setIsDriverBet(false);
          // Reset new fields
          setRiskLevel('HIGH');
          setDeliverableFrequency('MONTHLY');
          setDeliverableDay('');
          setDeliverableCost('');
          setDeliverableCondition('');
          setRefundPrice('0.9');
          fetchInstruments();
        } else {
          alert(result.message);
        }
    }
    setCreating(false);
  };

  const handleResolve = async (instrumentId: string, side: 'A' | 'B') => {
      // 1. Ask for Proof URL
      const proofUrl = prompt(t('economy.market.alerts.verify_url_prompt'));
      if (!proofUrl || !proofUrl.trim()) return;

      if (!confirm(t('economy.market.alerts.resolve_confirm', { side }))) return;
      
      const result = await resolveDriverBet(instrumentId, side, proofUrl);
      if (result.success) {
          alert(t('economy.market.alerts.resolve_success'));
          fetchInstruments();
      } else {
          alert(t('economy.market.alerts.resolve_failed', { message: result.message }));
      }
  };

  const isReleaseDatePassed = (dateStr?: string) => {
    if (!dateStr) return false;
    // Note: Stored as UTC. new Date(dateStr) works if dateStr is ISO.
    return new Date() >= new Date(dateStr);
  };

  const handleBuyDriverBet = async (instrument: Instrument, side: 'A' | 'B', qty: number) => {
      if (!qty || qty <= 0 || !Number.isInteger(qty)) {
          alert(t('economy.market.alerts.buy_integer'));
          return;
      }
      const result = await buyDriverBetTicket(instrument.id, side, qty);
      if (result.success) {
          alert(t('economy.market.alerts.buy_success', { qty, side }));
          setAmount({...amount, [`${instrument.id}_${side}`]: ''});
          fetchPositions();
      } else {
          alert(t('economy.market.alerts.buy_failed', { message: result.message }));
      }
  };

  const handleSellBackToOfficial = async (instrument: Instrument, qty: number) => {
      if (!qty || qty <= 0 || !Number.isInteger(qty)) {
          alert(t('economy.market.alerts.buy_integer'));
          return;
      }

      if (!confirm(`Are you sure you want to sell ${qty} tickets back to the official issuer for ${instrument.refund_price || 0.9} TKN/ticket?`)) return;

      const { data, error } = await supabase.rpc('sell_ticket_to_official', {
          p_instrument_id: instrument.id,
          p_quantity: qty
      });

      if (error) {
          console.error('Error selling back:', error);
          alert('Failed to sell back tickets: ' + error.message);
      } else {
          if (data.success) {
                alert(data.message);
                setAmount({...amount, [instrument.id]: ''});
                fetchPositions();
                refreshEconomy();
            } else {
                alert('Failed: ' + data.message);
            }
      }
  };

  const handleDelete = async (id: string, mode: 'MARKET' | 'EVERYWHERE') => {
      const modeText = mode === 'MARKET' ? t('economy.market.alerts.delete_mode_market') : t('economy.market.alerts.delete_mode_everywhere');
      if (!confirm(t('economy.market.alerts.delete_confirm', { mode: modeText }))) return;
      
      const result = await deleteCampaign(id, mode);
      if (result.success) {
          alert(t('economy.market.alerts.delete_success'));
          fetchInstruments();
      } else {
          alert(t('economy.market.alerts.delete_failed', { message: result.message }));
      }
  };

  const handleViewHolders = async (instrumentId: string, side: 'A' | 'B' | 'General', ticketTypeId?: string) => {
      if (!ticketTypeId) return;
      
      setViewingHolders({ id: instrumentId, side });
      setHoldersList([]);
      
      const { data, error } = await supabase.rpc('get_ticket_holders', {
          p_ticket_type_id: ticketTypeId
      });
      
      if (error) {
          console.error('Error fetching holders:', error);
          // If RPC is missing or fails, we just show empty list or error
      } else {
          setHoldersList(data || []);
      }
  };

  const BilingualText = ({ text, className = "" }: { text?: string, className?: string }) => {
      if (!text) return null;
      const parts = text.split('|').map(s => s.trim());
      if (parts.length <= 1) return <span className={className}>{text}</span>;
      return (
          <div className={`flex flex-col ${className}`}>
              <span>{parts[0]}</span>
              <span className="text-xs opacity-70 font-normal">{parts[1]}</span>
          </div>
      );
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
          <div className="flex items-center justify-center gap-2 mb-4">
            <h1 className="text-3xl font-bold font-mono text-white">{t('economy.market.title')}</h1>
            <PolicyInfo titleKey="policies.market_title" contentKey="policies.market_content" />
            <PolicyInfo titleKey="policies.betting_title" contentKey="policies.betting_content" />
            <PolicyInfo titleKey="policies.fees_title" contentKey="policies.fees_content" />
          </div>
          <p className="text-text-secondary max-w-2xl mx-auto mb-6">
            {t('economy.market.subtitle')}
            <br />
            <div className="flex flex-col gap-2 mt-4 items-center">
                <span className="text-xs text-yellow-500 flex items-center justify-center">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {t('economy.market.disclaimer')}
                </span>
                <span className="text-xs text-red-400/80 max-w-lg text-center">
                    {t('economy.market.alerts.disclaimer_full')}
                </span>
            </div>
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
          {wallet && wallet.reputation_balance > 50 && (
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
        {wallet && wallet.reputation_balance > 50 && (
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
              const userTicketA = instrument.ticket_type_a_id ? userPositions.find(p => p.ticket_type_id === instrument.ticket_type_a_id) : null;
              const userTicketB = instrument.ticket_type_b_id ? userPositions.find(p => p.ticket_type_id === instrument.ticket_type_b_id) : null;
              
              const isInvested = !!userTicket || !!userTicketA || !!userTicketB;
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
                    {t('economy.market.labels.invested')}
                  </div>
                )}
                {isDelisted && (
                   <div className="absolute top-0 left-0 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-br-lg z-10">
                     {t('economy.market.labels.delisted')}
                   </div>
                )}
                
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold text-white font-mono">{instrument.title}</h3>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs px-2 py-1 rounded font-mono border ${getRiskColor(instrument.risk_level)}`}>
                        {t('economy.market.labels.risk', { level: instrument.risk_level })}
                    </span>
                    {instrument.is_driver_bet && <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-1 rounded border border-purple-500/30">{t('economy.market.labels.driver_bet')}</span>}
                  </div>
                </div>
                <p className="text-text-secondary text-sm mb-6 flex-grow">{instrument.description}</p>
                
                {instrument.is_driver_bet ? (
                    <div className="mb-4 bg-background/50 p-3 rounded space-y-3">
                        <div className="flex justify-between items-start bg-white/5 p-2 rounded">
                            <div className="text-center w-1/2 border-r border-white/10 pr-2 flex flex-col items-center">
                                <div className="text-xs text-text-secondary">{t('economy.market.labels.side_a')}</div>
                                <div className="font-bold text-white text-sm"><BilingualText text={instrument.side_a_name} /></div>
                                {(isCreator || isInvested) && driverBetStats[instrument.id] && (
                                    <div className="text-[10px] text-white/60 font-mono mt-0.5">
                                        {t('economy.market.labels.sold', { count: driverBetStats[instrument.id].side_a_sold })}
                                    </div>
                                )}
                                {userTicketA && <div className="text-xs text-green-400 mt-1 font-mono">{t('economy.market.labels.owned', { count: userTicketA?.balance })}</div>}
                                {(isCreator || userTicketA) && (
                                    <button 
                                        onClick={() => handleViewHolders(instrument.id, 'A', instrument.ticket_type_a_id)}
                                        className="text-[10px] text-primary hover:text-primary/80 mt-1 border border-primary/30 px-2 py-0.5 rounded"
                                    >
                                        {t('economy.market.labels.view_holders')}
                                    </button>
                                )}
                            </div>
                            <div className="text-center w-1/2 pl-2 flex flex-col items-center">
                                <div className="text-xs text-text-secondary">{t('economy.market.labels.side_b')}</div>
                                <div className="font-bold text-white text-sm"><BilingualText text={instrument.side_b_name} /></div>
                                {(isCreator || isInvested) && driverBetStats[instrument.id] && (
                                    <div className="text-[10px] text-white/60 font-mono mt-0.5">
                                        {t('economy.market.labels.sold', { count: driverBetStats[instrument.id].side_b_sold })}
                                    </div>
                                )}
                                {userTicketB && <div className="text-xs text-green-400 mt-1 font-mono">{t('economy.market.labels.owned', { count: userTicketB?.balance })}</div>}
                                {(isCreator || userTicketB) && (
                                    <button 
                                        onClick={() => handleViewHolders(instrument.id, 'B', instrument.ticket_type_b_id)}
                                        className="text-[10px] text-primary hover:text-primary/80 mt-1 border border-primary/30 px-2 py-0.5 rounded"
                                    >
                                        {t('economy.market.labels.view_holders')}
                                    </button>
                                )}
                            </div>
                        </div>

                        {viewingHolders && viewingHolders.id === instrument.id && (
                            <div className="bg-black/40 p-3 rounded border border-white/10 relative">
                                <button 
                                    onClick={() => setViewingHolders(null)}
                                    className="absolute top-2 right-2 text-white/50 hover:text-white"
                                >
                                    <XCircle size={14} />
                                </button>
                                <div className="text-xs font-bold text-white mb-2">
                                    {t('economy.market.labels.holders', { side: viewingHolders.side })}
                                </div>
                                <div className="max-h-32 overflow-y-auto space-y-1">
                                    {holdersList.length === 0 ? (
                                        <div className="text-xs text-white/30 italic">{t('economy.market.labels.no_holders')}</div>
                                    ) : (
                                        holdersList.map((h, idx) => (
                                            <div key={idx} className="flex justify-between text-xs font-mono border-b border-white/5 pb-1 last:border-0">
                                                <span className="text-white/80">{h.username || t('economy.market.labels.unknown')}</span>
                                                <span className="text-primary">{h?.balance}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                        
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                            <div className="bg-white/5 p-2 rounded">
                                <div className="text-text-secondary">{t('economy.market.labels.price')}</div>
                                <div className="text-white">{instrument.ticket_price} {t('economy.wallet.currency.tkn')}</div>
                            </div>
                            <div className="bg-white/5 p-2 rounded">
                                <div className="text-text-secondary">{t('economy.market.labels.limit')}</div>
                                <div className="text-white">{instrument.ticket_limit}</div>
                            </div>
                            <div className="bg-white/5 p-2 rounded col-span-2">
                                <div className="text-text-secondary">{t('economy.market.labels.result') || 'Result Release'}</div>
                                <div className="text-white font-bold text-yellow-500">{instrument.open_date ? new Date(instrument.open_date).toLocaleString() : '-'}</div>
                            </div>
                        </div>

                        {!isDelisted && instrument.resolution_status !== 'RESOLVED' && (
                            <div className="space-y-2 pt-2">
                                <div className="flex gap-2">
                                    <input 
                                        type="number" 
                                        placeholder={`${t('economy.market.ticket.qty')} ${instrument.side_a_name?.split('|')[0]}`}
                                        className="w-16 bg-background border border-white/10 rounded px-2 py-1 text-white text-xs"
                                        value={amount[`${instrument.id}_A`] || ''}
                                        onChange={e => setAmount({...amount, [`${instrument.id}_A`]: e.target.value})}
                                    />
                                    <button 
                                        onClick={() => handleBuyDriverBet(instrument, 'A', parseInt(amount[`${instrument.id}_A`]))}
                                        className="flex-1 bg-primary/20 text-primary border border-primary/50 text-xs py-1 rounded hover:bg-primary/30 truncate"
                                    >
                                        {t('economy.market.labels.buy_action')} <BilingualText text={instrument.side_a_name} className="inline" />
                                    </button>
                                </div>
                                <div className="flex gap-2">
                                    <input 
                                        type="number" 
                                        placeholder={`${t('economy.market.ticket.qty')} ${instrument.side_b_name?.split('|')[0]}`}
                                        className="w-16 bg-background border border-white/10 rounded px-2 py-1 text-white text-xs"
                                        value={amount[`${instrument.id}_B`] || ''}
                                        onChange={e => setAmount({...amount, [`${instrument.id}_B`]: e.target.value})}
                                    />
                                    <button 
                                        onClick={() => handleBuyDriverBet(instrument, 'B', parseInt(amount[`${instrument.id}_B`]))}
                                        className="flex-1 bg-primary/20 text-primary border border-primary/50 text-xs py-1 rounded hover:bg-primary/30 truncate"
                                    >
                                        {t('economy.market.labels.buy_action')} <BilingualText text={instrument.side_b_name} className="inline" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Resolution Controls for Creator/Dev */}
                        {(wallet?.reputation_balance! > 70 || user?.id === instrument.creator_id) && instrument.resolution_status !== 'RESOLVED' && (
                            <div className="pt-2 border-t border-white/10">
                                <div className="text-xs text-text-secondary mb-1">{t('economy.market.labels.declare_result')}</div>
                                {!isReleaseDatePassed(instrument.open_date) && (
                                    <div className="text-xs text-yellow-500 mb-1">
                                        {t('economy.market.labels.release_date')}{instrument.open_date ? new Date(instrument.open_date).toLocaleString() : 'N/A'}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => handleResolve(instrument.id, 'A')} 
                                        disabled={!isReleaseDatePassed(instrument.open_date)}
                                        className={`flex-1 text-xs py-1 rounded transition-colors ${!isReleaseDatePassed(instrument.open_date) ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}`}
                                    >
                                        {instrument.side_a_name} {t('economy.market.labels.wins')}
                                    </button>
                                    <button 
                                        onClick={() => handleResolve(instrument.id, 'B')} 
                                        disabled={!isReleaseDatePassed(instrument.open_date)}
                                        className={`flex-1 text-xs py-1 rounded transition-colors ${!isReleaseDatePassed(instrument.open_date) ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}`}
                                    >
                                        {instrument.side_b_name} {t('economy.market.labels.wins')}
                                    </button>
                                </div>
                            </div>
                        )}

                        {instrument.resolution_status === 'RESOLVED' && (
                            <div className="bg-green-500/20 text-green-400 text-center py-2 rounded font-bold text-sm border border-green-500/30">
                                {t('economy.market.labels.resolved_won', { name: instrument.winning_side === 'A' ? instrument.side_a_name : instrument.side_b_name })}
                            </div>
                        )}
                    </div>
                ) : (
                    /* Standard Campaign Display */
                    <>
                    {instrument.refund_schedule && instrument.refund_schedule.length > 0 ? (
                        <div className="mb-4 bg-background/50 p-3 rounded">
                            <div className="text-text-secondary text-xs mb-2">{t('economy.market.labels.refund_schedule_title')}</div>
                            <div className="space-y-1 max-h-24 overflow-y-auto">
                                {instrument.refund_schedule.map((item, idx) => (
                                    <div key={idx} className="flex justify-between text-xs font-mono">
                                        <span className="text-white">{item.date}</span>
                                        <span className="text-green-400">{item.amount} {t('economy.wallet.tokens')}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                          <div className="bg-background/50 p-2 rounded">
                            <div className="text-text-secondary text-xs">{t('economy.market.instrument.frequency')}</div>
                            <div className="text-green-400 font-mono text-xs">{instrument.deliverable_frequency}</div>
                          </div>
                          <div className="bg-background/50 p-2 rounded">
                            <div className="text-text-secondary text-xs">{t('economy.market.instrument.cost_per_ticket')}</div>
                            <div className="text-white font-mono text-xs">{instrument.deliverable_cost_per_ticket} {t('economy.wallet.currency.tkn')}</div>
                          </div>
                          <div className="col-span-2 bg-background/50 p-2 rounded">
                             <div className="text-text-secondary text-xs">{t('economy.market.instrument.condition')}</div>
                             <div className="text-white/80 text-xs italic">{instrument.deliverable_condition}</div>
                          </div>
                        </div>
                    )}
                    
                    {/* Standard Buy Action */}
                    {!isDelisted && (
                        <div className="flex space-x-2 mt-auto">
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
                        {t('economy.market.labels.buy_one_tkn')}
                    </button>
                    <button
                        onClick={() => handleSellBackToOfficial(instrument, parseInt(amount[instrument.id]))}
                        className="bg-yellow-500 text-background font-bold px-4 py-2 rounded hover:bg-yellow-500/90 transition-colors text-sm font-mono whitespace-nowrap"
                    >
                        {t('economy.market.labels.sell_back')} ({instrument.refund_price || 0.9})
                    </button>
                        </div>
                    )}
                    </>
                )}

                {userTicket && (
                  <div className="mb-4 bg-primary/10 border border-primary/30 rounded p-3 mt-4">
                    <div className="text-primary text-xs mb-1">{t('economy.market.labels.your_tickets')}</div>
                    <div className="text-white font-mono font-bold">{userTicket?.balance} {t('economy.market.labels.tickets')}</div>
                  </div>
                )}
                
                {/* Creator Controls */}
                {isCreator && (
                    <div className="flex space-x-2 pt-2 border-t border-white/10 mt-4">
                        <button
                            onClick={() => handleDelete(instrument.id, 'MARKET')}
                            className="flex-1 flex items-center justify-center gap-1 bg-yellow-500/20 text-yellow-500 text-xs py-1 rounded hover:bg-yellow-500/30"
                            title={t('economy.market.actions.delist_title')}
                        >
                            <XCircle size={12} /> {t('economy.market.actions.delist')}
                        </button>
                        <button
                            onClick={() => handleDelete(instrument.id, 'EVERYWHERE')}
                            className="flex-1 flex items-center justify-center gap-1 bg-red-500/20 text-red-500 text-xs py-1 rounded hover:bg-red-500/30"
                            title={t('economy.market.actions.delete_title')}
                        >
                            <Trash2 size={12} /> {t('economy.market.actions.delete')}
                        </button>
                    </div>
                )}
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
                
                {/* Instrument Type Selection */}
                <div className="bg-white/5 p-3 rounded mb-4">
                    <div className="text-xs text-text-secondary mb-2">{t('economy.market.campaign.type_label') || 'Instrument Type'}</div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setIsDriverBet(false)}
                            disabled={!wallet || wallet.reputation_balance < 70}
                            className={`flex-1 py-2 text-xs rounded border transition-colors ${!isDriverBet ? 'bg-primary/20 border-primary text-primary' : 'bg-transparent border-white/10 text-white/50'} ${(!wallet || wallet.reputation_balance < 70) ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50'}`}
                        >
                            {t('economy.market.campaign.type_normal') || 'Normal Instrument'}
                            {(!wallet || wallet.reputation_balance < 70) && <div className="text-[10px] mt-1">(Req: 70 REP)</div>}
                        </button>
                        <button
                            onClick={() => setIsDriverBet(true)}
                            className={`flex-1 py-2 text-xs rounded border transition-colors ${isDriverBet ? 'bg-purple-500/20 border-purple-500 text-purple-400' : 'bg-transparent border-white/10 text-white/50'} hover:border-purple-500/50`}
                        >
                            {t('economy.market.campaign.type_driver_bet') || 'Driver Bet'}
                            <div className="text-[10px] mt-1">(Req: 50 REP)</div>
                        </button>
                    </div>
                </div>

                {isDriverBet ? (
                    <div className="space-y-4 border border-white/10 rounded p-3">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-text-secondary mb-1">{t('economy.market.campaign.event_label')}</label>
                                <input
                                    type="text"
                                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                    placeholder={t('economy.market.campaign.event_placeholder')}
                                    value={sideA}
                                    onChange={(e) => setSideA(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-text-secondary mb-1">{t('economy.market.campaign.side_b_label')}</label>
                                <input
                                    type="text"
                                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white/50 cursor-not-allowed"
                                    placeholder={t('economy.market.campaign.side_b_suffix')}
                                    value={sideA ? `${sideA}${t('economy.market.campaign.side_b_suffix')}` : ''}
                                    disabled
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-text-secondary mb-1">{t('economy.market.campaign.ticket_price_label')}</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0.1"
                                    max="100"
                                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                    value={ticketPrice}
                                    onChange={(e) => setTicketPrice(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-text-secondary mb-1">{t('economy.market.campaign.ticket_limit_label')}</label>
                                <input
                                    type="number"
                                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                    value={ticketLimit}
                                    onChange={(e) => setTicketLimit(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm text-text-secondary mb-1">{t('economy.market.campaign.sales_end_label')}</label>
                                <input
                                    type="datetime-local"
                                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-text-secondary mb-1">{t('economy.market.campaign.result_release_label')}</label>
                                <input
                                    type="datetime-local"
                                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                    value={openDate}
                                    onChange={(e) => setOpenDate(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="text-xs text-text-secondary">
                           {t('economy.market.campaign.timezone_note')}
                        </div>
                    </div>
                ) : (
                    /* Standard Campaign Display */
                    <div className="space-y-4">
                        {/* Risk Level */}
                        <div>
                            <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.risk_level') || 'Risk Level'}</label>
                            <select 
                                className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                value={riskLevel}
                                onChange={e => setRiskLevel(e.target.value)}
                            >
                                <option value="LOW">LOW</option>
                                <option value="MID">MID</option>
                                <option value="HIGH">HIGH</option>
                            </select>
                        </div>

                        {/* Deliverable Info */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.frequency') || 'Deliverable Frequency'}</label>
                                <select 
                                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                    value={deliverableFrequency}
                                    onChange={e => setDeliverableFrequency(e.target.value)}
                                >
                                    <option value="DAILY">Daily</option>
                                    <option value="WEEKLY">Weekly</option>
                                    <option value="MONTHLY">Monthly</option>
                                    <option value="QUARTERLY">Quarterly</option>
                                    <option value="YEARLY">Yearly</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.day') || 'Deliverable Day'}</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Monday, 1st"
                                    className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                    value={deliverableDay}
                                    onChange={e => setDeliverableDay(e.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.cost_per_ticket') || 'Deliverable Amount per Ticket (%)'}</label>
                            <input
                                type="number"
                                placeholder="e.g. 5"
                                className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                value={deliverableCost}
                                onChange={e => setDeliverableCost(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.condition') || 'Deliverable Condition'}</label>
                            <textarea
                                className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                rows={2}
                                placeholder="Under which condition will it be delivered?"
                                value={deliverableCondition}
                                onChange={e => setDeliverableCondition(e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="block text-xs text-text-secondary mb-1">{t('economy.market.campaign.refund_price_label')}</label>
                            <input
                                type="number"
                                step="0.01"
                                className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                                value={refundPrice}
                                onChange={e => setRefundPrice(e.target.value)}
                                placeholder="0.9"
                            />
                        </div>

                        {/* Bond Info */}
                        <div className="bg-yellow-500/10 border border-yellow-500/30 p-3 rounded text-xs text-yellow-200">
                            <span className="font-bold">Creation Bond:</span> 100 Tokens. This bond is non-refundable and will be distributed to developers as a system fee.
                        </div>
                    </div>
                )}

              </div>
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-white/10 text-white py-2 rounded hover:bg-white/20"
                >
                  {t('economy.market.actions.cancel')}
                </button>
                <button
                  onClick={handleCreateCampaign}
                  disabled={creating}
                  className="flex-1 bg-primary text-background font-bold py-2 rounded hover:bg-primary/90"
                >
                  {creating ? t('economy.market.campaign.creating') : t('economy.market.campaign.submit')}
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
