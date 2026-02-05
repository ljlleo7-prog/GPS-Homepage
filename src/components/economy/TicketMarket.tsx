import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useEconomy } from '../../context/EconomyContext';
import { useAuth } from '../../context/AuthContext';
import { motion } from 'framer-motion';
import { Tag, DollarSign, Lock, RefreshCw, ShoppingCart, PlusCircle } from 'lucide-react';

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
  const { user } = useAuth();
  const { createTicketListing, purchaseTicketListing, refreshEconomy } = useEconomy();
  const [activeTab, setActiveTab] = useState<'market' | 'holdings'>('market');
  
  const [listings, setListings] = useState<TicketListing[]>([]);
  const [holdings, setHoldings] = useState<UserTicketBalance[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Modal States
  const [selectedListing, setSelectedListing] = useState<TicketListing | null>(null);
  const [sellTicketId, setSellTicketId] = useState<string | null>(null);
  const [sellQty, setSellQty] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [password, setPassword] = useState('');
  const [modalOpen, setModalOpen] = useState<'buy' | 'sell' | null>(null);

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

      // Fetch Holdings if logged in
      if (user) {
        const { data: holdingsData } = await supabase
          .from('user_ticket_balances')
          .select('*, ticket_types(title, description)')
          .eq('user_id', user.id)
          .gt('balance', 0);
        setHoldings(holdingsData || []);
      }

      // Fetch Ticket Types (for general info if needed, or creating listing context)
      // (Implicitly fetched via holdings for selling)
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async () => {
    if (!selectedListing || !password) return;
    setProcessing(true);
    const result = await purchaseTicketListing(selectedListing.id, password);
    setProcessing(false);
    
    if (result.success) {
      alert('Purchase successful!');
      setModalOpen(null);
      setPassword('');
      fetchData();
    } else {
      alert('Error: ' + result.message);
    }
  };

  const handleSell = async () => {
    if (!sellTicketId || !sellQty || !sellPrice || !password) return;
    setProcessing(true);
    const result = await createTicketListing(
      sellTicketId, 
      parseInt(sellQty), 
      parseFloat(sellPrice), 
      password
    );
    setProcessing(false);

    if (result.success) {
      alert('Listing created!');
      setModalOpen(null);
      setPassword('');
      setSellQty('');
      setSellPrice('');
      fetchData();
    } else {
      alert('Error: ' + result.message);
    }
  };

  if (loading && !listings.length) return <div className="text-white">Loading Market...</div>;

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex space-x-4 border-b border-white/10 pb-2">
        <button
          onClick={() => setActiveTab('market')}
          className={`px-4 py-2 font-mono text-sm ${activeTab === 'market' ? 'text-primary border-b-2 border-primary' : 'text-text-secondary'}`}
        >
          Active Listings
        </button>
        <button
          onClick={() => setActiveTab('holdings')}
          className={`px-4 py-2 font-mono text-sm ${activeTab === 'holdings' ? 'text-primary border-b-2 border-primary' : 'text-text-secondary'}`}
        >
          My Holdings & Sell
        </button>
        <button onClick={fetchData} className="ml-auto text-text-secondary hover:text-white">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Market Tab */}
      {activeTab === 'market' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {listings.length === 0 && <div className="text-text-secondary col-span-3">No active listings.</div>}
          {listings.map(listing => (
            <motion.div
              key={listing.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-surface border border-white/10 rounded-lg p-4 flex flex-col"
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-lg font-bold text-white font-mono">{listing.ticket_types.title}</h3>
                <span className="text-xs text-text-secondary font-mono">by {listing.profiles?.username || 'Unknown'}</span>
              </div>
              
              <div className="flex justify-between items-center bg-background/50 p-2 rounded mb-4">
                <div className="text-center">
                  <div className="text-xs text-text-secondary">QTY</div>
                  <div className="text-lg font-bold text-white">{listing.quantity}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-text-secondary">PRICE/UNIT</div>
                  <div className="text-lg font-bold text-primary">{listing.price_per_unit} T</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-text-secondary">TOTAL</div>
                  <div className="text-lg font-bold text-white">{(listing.quantity * listing.price_per_unit).toFixed(0)} T</div>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedListing(listing);
                  setModalOpen('buy');
                }}
                className="mt-auto w-full py-2 bg-primary/20 hover:bg-primary/30 text-primary rounded font-mono font-bold flex items-center justify-center transition-colors"
              >
                <ShoppingCart className="w-4 h-4 mr-2" />
                BUY NOW
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {/* Holdings Tab */}
      {activeTab === 'holdings' && (
        <div className="space-y-4">
          {holdings.length === 0 && <div className="text-text-secondary">You don't own any mission tickets yet.</div>}
          {holdings.map(holding => (
            <div key={holding.id} className="bg-surface border border-white/10 rounded-lg p-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white font-mono">{holding.ticket_types.title}</h3>
                <p className="text-sm text-text-secondary">{holding.ticket_types.description}</p>
                <div className="mt-1 text-primary font-mono">Balance: {holding.balance} units</div>
              </div>
              <button
                onClick={() => {
                  setSellTicketId(holding.ticket_type_id);
                  setModalOpen('sell');
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded font-mono flex items-center"
              >
                <PlusCircle className="w-4 h-4 mr-2" />
                SELL
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Buy Modal */}
      {modalOpen === 'buy' && selectedListing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-white/20 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-4 font-mono">Confirm Purchase</h3>
            <div className="space-y-4 mb-6">
              <div className="p-4 bg-background rounded border border-white/10">
                <div className="flex justify-between mb-2">
                  <span className="text-text-secondary">Item:</span>
                  <span className="text-white font-bold">{selectedListing.ticket_types.title}</span>
                </div>
                <div className="flex justify-between mb-2">
                  <span className="text-text-secondary">Quantity:</span>
                  <span className="text-white">{selectedListing.quantity}</span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-2 mt-2">
                  <span className="text-text-secondary">Total Cost:</span>
                  <span className="text-primary font-bold">{(selectedListing.quantity * selectedListing.price_per_unit).toFixed(2)} Tokens</span>
                </div>
              </div>
              
              <div>
                <label className="block text-xs text-text-secondary mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-background border border-white/20 rounded p-2 text-white"
                  placeholder="Enter your password to confirm"
                />
              </div>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={() => setModalOpen(null)}
                className="flex-1 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors"
                disabled={processing}
              >
                Cancel
              </button>
              <button
                onClick={handleBuy}
                disabled={processing || !password}
                className="flex-1 py-2 bg-primary text-background font-bold rounded hover:bg-primary/90 transition-colors flex justify-center items-center"
              >
                {processing ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Confirm Buy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {modalOpen === 'sell' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-surface border border-white/20 rounded-xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-4 font-mono">Create Listing</h3>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-xs text-text-secondary mb-1">Quantity to Sell</label>
                <input
                  type="number"
                  value={sellQty}
                  onChange={e => setSellQty(e.target.value)}
                  className="w-full bg-background border border-white/20 rounded p-2 text-white"
                  placeholder="Amount"
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Price per Unit (Tokens)</label>
                <input
                  type="number"
                  value={sellPrice}
                  onChange={e => setSellPrice(e.target.value)}
                  className="w-full bg-background border border-white/20 rounded p-2 text-white"
                  placeholder="Price"
                />
              </div>
              
              <div>
                <label className="block text-xs text-text-secondary mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-background border border-white/20 rounded p-2 text-white"
                  placeholder="Enter your password to confirm"
                />
              </div>
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={() => setModalOpen(null)}
                className="flex-1 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors"
                disabled={processing}
              >
                Cancel
              </button>
              <button
                onClick={handleSell}
                disabled={processing || !password || !sellQty || !sellPrice}
                className="flex-1 py-2 bg-primary text-background font-bold rounded hover:bg-primary/90 transition-colors flex justify-center items-center"
              >
                {processing ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Create Listing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
