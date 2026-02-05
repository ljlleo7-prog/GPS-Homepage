import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface Wallet {
  id: string;
  token_balance: number;
  reputation_balance: number;
}

interface LedgerEntry {
  id: string;
  amount: number;
  currency: 'TOKEN' | 'REP';
  operation_type: string;
  description: string;
  created_at: string;
}

interface EconomyContextType {
  wallet: Wallet | null;
  ledger: LedgerEntry[];
  loading: boolean;
  refreshEconomy: () => Promise<void>;
  enterPosition: (instrumentId: string, amount: number) => Promise<{ success: boolean; message?: string }>;
  createTicketListing: (ticketId: string, quantity: number, price: number, password: string) => Promise<{ success: boolean; message?: string }>;
  purchaseTicketListing: (listingId: string, password: string) => Promise<{ success: boolean; message?: string }>;
}

const EconomyContext = createContext<EconomyContextType>({
  wallet: null,
  ledger: [],
  loading: true,
  refreshEconomy: async () => {},
  enterPosition: async () => ({ success: false }),
  createTicketListing: async () => ({ success: false }),
  purchaseTicketListing: async () => ({ success: false }),
});

export const useEconomy = () => useContext(EconomyContext);

export const EconomyProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshEconomy = async () => {
    if (!user) {
      setWallet(null);
      setLedger([]);
      setLoading(false);
      return;
    }

    try {
      // Fetch Wallet
      const { data: walletData, error: walletError } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (walletError) throw walletError;
      setWallet(walletData);

      // Fetch Ledger
      if (walletData) {
        const { data: ledgerData, error: ledgerError } = await supabase
          .from('ledger_entries')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (ledgerError) throw ledgerError;
        setLedger(ledgerData);
      }
    } catch (error) {
      console.error('Error fetching economy data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshEconomy();
  }, [user]);

  const enterPosition = async (instrumentId: string, amount: number) => {
    try {
      const { data, error } = await supabase.rpc('enter_support_position', {
        p_instrument_id: instrumentId,
        p_amount: amount,
      });

      if (error) throw error;
      
      await refreshEconomy();
      return { success: true };
    } catch (error: any) {
      console.error('Error entering position:', error);
      return { success: false, message: error.message || 'Transaction failed' };
    }
  };

  const createTicketListing = async (ticketId: string, quantity: number, price: number, password: string) => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      const { data, error } = await supabase.functions.invoke('economy-ops', {
        body: {
          action: 'create_ticket_listing',
          payload: { user_id: user.id, password, ticket_type_id: ticketId, quantity, price }
        }
      });

      if (error) throw error;
      // The function might return error in body if not throwing
      if (data && data.error) throw new Error(data.error);

      await refreshEconomy();
      return { success: true };
    } catch (error: any) {
      console.error('Error creating listing:', error);
      return { success: false, message: error.message || 'Failed to create listing' };
    }
  };

  const purchaseTicketListing = async (listingId: string, password: string) => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      const { data, error } = await supabase.functions.invoke('economy-ops', {
        body: {
          action: 'purchase_ticket_listing',
          payload: { user_id: user.id, password, listing_id: listingId }
        }
      });

      if (error) throw error;
      if (data && data.error) throw new Error(data.error);

      await refreshEconomy();
      return { success: true };
    } catch (error: any) {
      console.error('Error purchasing listing:', error);
      return { success: false, message: error.message || 'Failed to purchase listing' };
    }
  };

  return (
    <EconomyContext.Provider value={{ wallet, ledger, loading, refreshEconomy, enterPosition, createTicketListing, purchaseTicketListing }}>
      {children}
    </EconomyContext.Provider>
  );
};
