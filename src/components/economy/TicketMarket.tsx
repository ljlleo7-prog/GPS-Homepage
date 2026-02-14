import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useEconomy } from '../../context/EconomyContext';
import { useAuth } from '../../context/AuthContext';
import { motion } from 'framer-motion';
import { Tag, DollarSign, Lock, RefreshCw, ShoppingCart, PlusCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface TicketType {
  id: string;
  title: string;
  description: string;
}

interface TicketListing {
  id: string;
  ticket_type_id: string;
  quantity: number;
  price_per_unit: number;
  seller_id: string;
  ticket_types: { title: string };
  profiles: { username: string };
}

interface UserTicketBalance {
  id: string;
  ticket_type_id: string;
  balance: number;
  ticket_types: { title: string; description: string };
}

export const TicketMarket = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { wallet, createTicketListing, purchaseTicketListing, withdrawTicketListing, refreshEconomy } = useEconomy();
  const [activeTab, setActiveTab] = useState<'market' | 'holdings'>('market');
  
  const [listings, setListings] = useState<TicketListing[]>([]);
  const [holdings, setHoldings] = useState<UserTicketBalance[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [avgPrices, setAvgPrices] = useState<Record<string, number>>({});
  const [civilAvg, setCivilAvg] = useState<Record<string, number>>({});
  
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Modal States
  const [selectedListing, setSelectedListing] = useState<TicketListing | null>(null);
  const [sellTicketId, setSellTicketId] = useState<string | null>(null);
  const [sellQty, setSellQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [password, setPassword] = useState('');
  const [modalOpen, setModalOpen] = useState<'buy' | 'sell' | 'withdraw' | null>(null);

  useEffect(() => {
    fetchData();
  }, [user, activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch Listings
      const { data: listingsData } = await supabase
        .from('ticket_listings')
        .select('*, ticket_types(title), profiles(username)')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false });
      setListings(listingsData || []);

      // Civil avg price per ticket type (last 24h)
      const nextCivil: Record<string, number> = {};
      const uniqueTypes = Array.from(new Set((listingsData || []).map((l: TicketListing) => l.ticket_type_id)));
      await Promise.all(uniqueTypes.map(async (tid) => {
        const { data: avgVal } = await supabase.rpc('get_civil_avg_price', { p_ticket_type_id: tid });
        if (avgVal !== null && avgVal !== undefined) {
          nextCivil[tid] = parseFloat(Number(avgVal).toFixed(4));
        }
      }));
      setCivilAvg(nextCivil);

      // Fetch Holdings if logged in
      if (user) {
        const { data: holdingsData } = await supabase
          .from('user_ticket_balances')
          .select('*, ticket_types(title, description)')
          .eq('user_id', user.id)
          .gt('balance', 0);
        setHoldings(holdingsData || []);

        // Compute average purchase price per ticket type (weighted)
        const nextAvg: Record<string, number> = {};
        await Promise.all((holdingsData || []).map(async (h: UserTicketBalance) => {
          const { data: avgVal } = await supabase
            .rpc('get_avg_buy_price', { p_ticket_type_id: h.ticket_type_id });
          if (avgVal !== null && avgVal !== undefined) {
            nextAvg[h.ticket_type_id] = parseFloat(Number(avgVal).toFixed(4));
          }
        }));
        setAvgPrices(nextAvg);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async () => {
    // Rep Gating > 50
    if (!wallet || wallet.reputation_balance <= 50) {
      alert(t('economy.market.ticket.low_rep'));
      return;
    }

    if (!selectedListing || !password) return;
    setProcessing(true);
    const result = await purchaseTicketListing(selectedListing.id, password);
    setProcessing(false);
    
    if (result.success) {
      alert(t('economy.market.ticket.alerts.purchase_success'));
      setModalOpen(null);
      setPassword('');
      fetchData();
    } else {
      alert(t('economy.market.ticket.alerts.error_prefix') + result.message);
    }
  };

  const handleSell = async () => {
    // Rep Gating > 50
    if (!wallet || wallet.reputation_balance <= 50) {
      alert(t('economy.market.ticket.low_rep'));
      return;
    }

    if (!sellTicketId || !sellQty || !sellPrice || !password) return;
    setProcessing(true);
    const result = await createTicketListing(sellTicketId, parseInt(sellQty), parseFloat(sellPrice), password);
    setProcessing(false);

    if (result.success) {
      alert(t('economy.market.ticket.alerts.listing_success'));
      setModalOpen(null);
      setPassword('');
      fetchData();
    } else {
      alert(t('economy.market.ticket.alerts.error_prefix') + result.message);
    }
  };

  const handleWithdraw = async () => {
    if (!selectedListing || !password) return;
    setProcessing(true);
    const result = await withdrawTicketListing(selectedListing.id, password);
    setProcessing(false);
    if (result.success) {
      alert(t('economy.market.ticket.alerts.withdraw_success') || 'Listing withdrawn');
      setModalOpen(null);
      setPassword('');
      fetchData();
    } else {
      alert((t('economy.market.ticket.alerts.error_prefix') || 'Error: ') + (result.message || 'Failed to withdraw'));
    }
  };

  if (loading) return <div className="text-center py-8">{t('economy.missions.loading')}</div>;

  return (
    <div>
      <div className="flex space-x-4 mb-6" />

      {activeTab === 'market' ? (
        <>
        <div className="bg-green-500/10 border border-green-500/30 text-green-300 rounded p-3 mb-4">
          <div className="font-mono text-sm">
            {t('economy.market.ticket.civil_market_banner') || 'Trade on the Civil Market to boost mobility. You can withdraw your listing anytime until sold.'}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {listings.length === 0 ? (
            <div className="col-span-full text-center text-text-secondary py-8">{t('economy.market.ticket.no_listings')}</div>
          ) : (
            listings.map((listing) => (
              <motion.div key={listing.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-surface border border-white/10 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="text-white font-bold">{listing.ticket_types.title}</h4>
                  <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded">
                    {listing.quantity} {t('economy.market.ticket.qty')}
                  </span>
                </div>
                <div className="text-sm text-text-secondary mb-4">
                  <div>{t('economy.market.ticket.seller')}: {listing.profiles.username}</div>
                  <div>{t('economy.market.ticket.price')}: {listing.price_per_unit} / {t('economy.market.ticket.unit')}</div>
                  <div className="font-bold text-white mt-1">{t('economy.market.ticket.total')}: {listing.price_per_unit * listing.quantity} {t('economy.wallet.tokens')}</div>
                  {civilAvg[listing.ticket_type_id] !== undefined && (
                    <div className="mt-1 text-xs text-white/70 font-mono">
                      Avg Civil: {civilAvg[listing.ticket_type_id]} / {t('economy.market.ticket.unit')}
                    </div>
                  )}
                </div>
                {user && user.id !== listing.seller_id ? (
                  <button
                    onClick={() => { setSelectedListing(listing); setModalOpen('buy'); }}
                    className="w-full bg-green-500/20 text-green-400 border border-green-500/50 py-2 rounded hover:bg-green-500/30 transition-colors"
                  >
                    {t('economy.market.ticket.buy')}
                  </button>
                ) : user && user.id === listing.seller_id ? (
                  <button
                    onClick={() => { setSelectedListing(listing); setModalOpen('withdraw'); }}
                    className="w-full bg-red-500/20 text-red-400 border border-red-500/50 py-2 rounded hover:bg-red-500/30 transition-colors"
                  >
                    {t('economy.market.ticket.withdraw') || 'Withdraw'}
                  </button>
                ) : null}
              </motion.div>
            ))
          )}
        </div>
        </>
      ) : null}

      {/* Buy Modal */}
      {modalOpen === 'buy' && selectedListing && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-white/20 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">{t('economy.market.ticket.buy')} {selectedListing.ticket_types.title}</h3>
            <p className="text-text-secondary mb-4">
              {t('economy.market.ticket.qty')}: {selectedListing.quantity} x {selectedListing.price_per_unit} = <span className="text-white font-bold">{selectedListing.quantity * selectedListing.price_per_unit} {t('economy.wallet.tokens')}</span>
            </p>
            <div className="mb-4">
              <label className="block text-xs text-text-secondary mb-1">{t('economy.market.ticket.confirm_password')}</label>
              <input
                type="password"
                className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex space-x-3">
              <button onClick={() => setModalOpen(null)} className="flex-1 bg-white/10 text-white py-2 rounded hover:bg-white/20">{t('economy.market.actions.cancel')}</button>
              <button onClick={handleBuy} disabled={processing} className="flex-1 bg-primary text-background font-bold py-2 rounded hover:bg-primary/90">
                {processing ? t('economy.market.ticket.processing') : t('economy.market.ticket.buy')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {modalOpen === 'sell' && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-white/20 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">{t('economy.market.ticket.create_listing')}</h3>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('economy.market.ticket.qty')}</label>
                <input
                  type="number"
                  className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                  value={sellQty}
                  onChange={(e) => setSellQty(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('economy.market.ticket.price')}</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('economy.market.ticket.confirm_password')}</label>
                <input
                  type="password"
                  className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex space-x-3">
              <button onClick={() => setModalOpen(null)} className="flex-1 bg-white/10 text-white py-2 rounded hover:bg-white/20">{t('economy.market.actions.cancel')}</button>
              <button onClick={handleSell} disabled={processing} className="flex-1 bg-primary text-background font-bold py-2 rounded hover:bg-primary/90">
                {processing ? t('economy.market.ticket.processing') : t('economy.market.ticket.list_for_sale')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdraw Modal */}
      {modalOpen === 'withdraw' && selectedListing && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-white/20 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">{t('economy.market.ticket.withdraw')} {selectedListing.ticket_types.title}</h3>
            <p className="text-text-secondary mb-4">
              {t('economy.market.ticket.qty')}: {selectedListing.quantity} × {selectedListing.price_per_unit} = <span className="text-white font-bold">{selectedListing.quantity * selectedListing.price_per_unit} {t('economy.wallet.tokens')}</span>
            </p>
            <div className="mb-4">
              <label className="block text-xs text-text-secondary mb-1">{t('economy.market.ticket.confirm_password')}</label>
              <input
                type="password"
                className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex space-x-3">
              <button onClick={() => setModalOpen(null)} className="flex-1 bg-white/10 text-white py-2 rounded hover:bg-white/20">{t('economy.market.actions.cancel')}</button>
              <button onClick={handleWithdraw} disabled={processing} className="flex-1 bg-primary text-background font-bold py-2 rounded hover:bg-primary/90">
                {processing ? t('economy.market.ticket.processing') : (t('economy.market.ticket.withdraw') || 'Withdraw')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const MyHoldings = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { wallet, createTicketListing } = useEconomy();
  const [holdings, setHoldings] = useState<UserTicketBalance[]>([]);
  const [avgPrices, setAvgPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState<'sell' | null>(null);
  const [sellTicketId, setSellTicketId] = useState<string | null>(null);
  const [sellQty, setSellQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [password, setPassword] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (user) {
        const { data: holdingsData } = await supabase
          .from('user_ticket_balances')
          .select('*, ticket_types(title, description)')
          .eq('user_id', user.id)
          .gt('balance', 0);
        setHoldings(holdingsData || []);

        const nextAvg: Record<string, number> = {};
        await Promise.all((holdingsData || []).map(async (h: UserTicketBalance) => {
          const { data: avgVal } = await supabase.rpc('get_avg_buy_price', { p_ticket_type_id: h.ticket_type_id });
          if (avgVal !== null && avgVal !== undefined) {
            nextAvg[h.ticket_type_id] = parseFloat(Number(avgVal).toFixed(4));
          }
        }));
        setAvgPrices(nextAvg);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSell = async () => {
    if (!wallet || wallet.reputation_balance <= 50) {
      alert(t('economy.market.ticket.low_rep'));
      return;
    }
    if (!sellTicketId || !sellQty || !sellPrice || !password) return;
    setProcessing(true);
    const result = await createTicketListing(sellTicketId, parseInt(sellQty), parseFloat(sellPrice), password);
    setProcessing(false);
    if (result.success) {
      alert(t('economy.market.ticket.alerts.listing_success'));
      setModalOpen(null);
      setPassword('');
      fetchData();
    } else {
      alert(t('economy.market.ticket.alerts.error_prefix') + result.message);
    }
  };

  if (loading) return <div className="text-center py-8">{t('economy.missions.loading')}</div>;

  return (
    <div className="space-y-4">
      {holdings.length === 0 ? (
         <div className="text-center text-text-secondary py-8">{t('economy.market.ticket.no_holdings')}</div>
      ) : (
        holdings.map((holding) => (
          <div key={holding.id} className="bg-surface border border-white/10 rounded-lg p-4 flex justify-between items-center">
            <div>
              <h4 className="text-white font-bold">{holding.ticket_types.title}</h4>
              <p className="text-sm text-text-secondary">{holding.ticket_types.description}</p>
              <div className="mt-2 text-primary font-mono">{holding.balance} {t('economy.market.ticket.units')}</div>
              {avgPrices[holding.ticket_type_id] !== undefined && (
                <div className="mt-1 text-xs text-white/70 font-mono">
                  {t('economy.market.ticket.avg_buy_price')}: {avgPrices[holding.ticket_type_id]} / {t('economy.market.ticket.unit')}
                </div>
              )}
            </div>
            <button
              onClick={() => { setSellTicketId(holding.ticket_type_id); setModalOpen('sell'); }}
              className="bg-blue-500/20 text-blue-400 border border-blue-500/50 px-4 py-2 rounded hover:bg-blue-500/30 transition-colors"
            >
              {t('economy.market.ticket.sell')}
            </button>
          </div>
        ))
      )}

      {modalOpen === 'sell' && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-white/20 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-white mb-4">{t('economy.market.ticket.create_listing')}</h3>
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('economy.market.ticket.qty')}</label>
                <input
                  type="number"
                  className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                  value={sellQty}
                  onChange={(e) => setSellQty(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('economy.market.ticket.price')}</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">{t('economy.market.ticket.confirm_password')}</label>
                <input
                  type="password"
                  className="w-full bg-background border border-white/10 rounded px-3 py-2 text-white"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex space-x-3">
              <button onClick={() => setModalOpen(null)} className="flex-1 bg-white/10 text-white py-2 rounded hover:bg-white/20">{t('economy.market.actions.cancel')}</button>
              <button onClick={handleSell} disabled={processing} className="flex-1 bg-primary text-background font-bold py-2 rounded hover:bg-primary/90">
                {processing ? t('economy.market.ticket.processing') : t('economy.market.ticket.list_for_sale')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
