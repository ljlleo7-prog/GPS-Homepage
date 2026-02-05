import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface Wallet {
  id: string;
  token_balance: number;
  reputation_balance: number;
  last_daily_bonus: string | null;
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
  developerStatus: 'NONE' | 'PENDING' | 'APPROVED';
  refreshEconomy: () => Promise<void>;
  enterPosition: (instrumentId: string, amount: number) => Promise<{ success: boolean; message?: string }>;
  createTicketListing: (ticketId: string, quantity: number, price: number, password: string) => Promise<{ success: boolean; message?: string }>;
  purchaseTicketListing: (listingId: string, password: string) => Promise<{ success: boolean; message?: string }>;
  claimDailyBonus: () => Promise<{ success: boolean; amount?: number; message?: string }>;
  requestDeveloperAccess: () => Promise<{ success: boolean; message?: string }>;
  approveDeveloperAccess: (targetUserId: string) => Promise<{ success: boolean; message?: string }>;
  createUserCampaign: (
    type: 'MISSION' | 'MARKET',
    title: string,
    description: string,
    rewardMin?: number,
    rewardMax?: number,
    yieldRate?: number,
    lockupDays?: number,
    refundSchedule?: any[],
    isDriverBet?: boolean
  ) => Promise<{ success: boolean; message?: string; data?: any }>;
  createDriverBet: (
    title: string,
    description: string,
    sideA: string, // Event Name
    ticketPrice: number,
    ticketLimit: number,
    endDate: string,
    openDate: string
  ) => Promise<{ success: boolean; message?: string; data?: any }>;
  buyDriverBetTicket: (
    instrumentId: string,
    side: 'A' | 'B',
    quantity: number
  ) => Promise<{ success: boolean; message?: string }>;
  resolveDriverBet: (
    instrumentId: string,
    winningSide: 'A' | 'B',
    proofUrl: string
  ) => Promise<{ success: boolean; message?: string }>;
  deleteCampaign: (id: string, mode: 'MARKET' | 'EVERYWHERE') => Promise<{ success: boolean; message?: string }>;
  playReactionGame: (scoreMs: number) => Promise<{ success: boolean; reward?: number; message?: string }>;
  getMonthlyLeaderboard: () => Promise<{ success: boolean; data?: any[] }>;
  getMonthlyPool: () => Promise<{ success: boolean; data?: any }>;
}

const EconomyContext = createContext<EconomyContextType>({
  wallet: null,
  ledger: [],
  loading: true,
  developerStatus: 'NONE',
  refreshEconomy: async () => {},
  enterPosition: async () => ({ success: false }),
  createTicketListing: async () => ({ success: false }),
  purchaseTicketListing: async () => ({ success: false }),
  claimDailyBonus: async () => ({ success: false }),
  requestDeveloperAccess: async () => ({ success: false }),
  approveDeveloperAccess: async () => ({ success: false }),
  createUserCampaign: async () => ({ success: false }),
  createDriverBet: async () => ({ success: false }),
  buyDriverBetTicket: async () => ({ success: false }),
  resolveDriverBet: async () => ({ success: false }),
  deleteCampaign: async () => ({ success: false }),
  playReactionGame: async () => ({ success: false }),
  getMonthlyLeaderboard: async () => ({ success: false }),
  getMonthlyPool: async () => ({ success: false }),
});

export const useEconomy = () => useContext(EconomyContext);

export const EconomyProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [developerStatus, setDeveloperStatus] = useState<'NONE' | 'PENDING' | 'APPROVED'>('NONE');
  const [loading, setLoading] = useState(true);

  const refreshEconomy = async () => {
    if (!user) {
      setWallet(null);
      setLedger([]);
      setDeveloperStatus('NONE');
      setLoading(false);
      return;
    }

    try {
      // Fetch Wallet
      let { data: walletData, error: walletError } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .single();

      // If wallet doesn't exist, try to create it
      if (walletError && walletError.code === 'PGRST116') {
        const { error: createError } = await supabase.rpc('ensure_wallet_exists');
        if (!createError) {
          // Retry fetch
          const retry = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', user.id)
            .single();
          walletData = retry.data;
          walletError = retry.error;
        }
      }

      if (walletError) throw walletError;
      setWallet(walletData);

      // Fetch Profile for Developer Status
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('developer_status')
        .eq('id', user.id)
        .single();
      
      if (!profileError && profileData) {
        setDeveloperStatus(profileData.developer_status as any || 'NONE');
      }

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
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      // Check if this is a new style campaign (ticket based)
      // For now, we try the new RPC 'buy_campaign_ticket'. If it fails (e.g. old instrument), fallback?
      // Actually, let's just use the new RPC. It checks for instrument existence.
      // Wait, 'enterPosition' was generic for Support Instruments.
      // If we are transitioning, we should use the new RPC for everything OR check instrument type.
      // Let's assume all 'MARKET' type instruments now use the new system.
      // But we have 'BOND' / 'INDEX' / 'MILESTONE' in the old system.
      // The user wants to trade "marketing campaign tickets".
      
      const { data, error } = await supabase.rpc('buy_campaign_ticket', {
        p_instrument_id: instrumentId,
        p_amount: Math.floor(amount) // Ensure integer for tickets
      });

      // If the RPC says "Campaign not found" or similar, maybe it's a legacy instrument?
      // But the migration didn't delete old tables.
      // Let's try to handle legacy fallback if needed, or just push forward.
      // Given the user wants to overhaul, let's prioritize the new path.
      
      if (error) {
         // Fallback to old system if RPC not found or fails for specific reason?
         // For now, throw error.
         throw error;
      }
      
      if (data && !data.success) throw new Error(data.message);

      await refreshEconomy();
      return { success: true };
    } catch (error: any) {
      console.error('Error entering position:', error);
      return { success: false, message: error.message || 'Failed to enter position' };
    }
  };

  const createTicketListing = async (ticketId: string, quantity: number, price: number, password: string) => {
    if (!user || !user.email) return { success: false, message: 'Not authenticated' };
    
    // Verify password
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password
    });
    if (authError) return { success: false, message: 'Incorrect password' };

    try {
      const { data, error } = await supabase.rpc('create_ticket_listing', {
        p_ticket_type_id: ticketId,
        p_quantity: quantity,
        p_price: price
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.message);

      await refreshEconomy();
      return { success: true };
    } catch (error: any) {
      console.error('Error creating listing:', error);
      return { success: false, message: error.message || 'Failed to create listing' };
    }
  };

  const purchaseTicketListing = async (listingId: string, password: string) => {
    if (!user || !user.email) return { success: false, message: 'Not authenticated' };

    // Verify password
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password
    });
    if (authError) return { success: false, message: 'Incorrect password' };

    try {
      const { data, error } = await supabase.rpc('purchase_ticket_listing', {
        p_listing_id: listingId
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.message);

      await refreshEconomy();
      return { success: true };
    } catch (error: any) {
      console.error('Error purchasing listing:', error);
      return { success: false, message: error.message || 'Failed to purchase listing' };
    }
  };

  const claimDailyBonus = async () => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      const { data, error } = await supabase.rpc('claim_daily_bonus');

      if (error) throw error;
      
      await refreshEconomy();
      return { success: true, amount: data };
    } catch (error: any) {
      console.error('Error claiming bonus:', error);
      return { success: false, message: error.message || 'Failed to claim bonus' };
    }
  };

  const requestDeveloperAccess = async () => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      const { error } = await supabase.rpc('request_developer_access');
      if (error) throw error;
      await refreshEconomy();
      return { success: true };
    } catch (error: any) {
      console.error('Error requesting dev access:', error);
      return { success: false, message: error.message || 'Failed to request access' };
    }
  };

  const approveDeveloperAccess = async (targetUserId: string) => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      const { error } = await supabase.rpc('approve_developer_access', {
        target_user_id: targetUserId
      });
      if (error) throw error;
      // No refresh needed for self, but maybe useful if we list users
      return { success: true };
    } catch (error: any) {
      console.error('Error approving dev access:', error);
      return { success: false, message: error.message || 'Failed to approve access' };
    }
  };

  const createUserCampaign = async (
    type: 'MISSION' | 'MARKET',
    title: string,
    description: string,
    rewardMin?: number,
    rewardMax?: number,
    yieldRate?: number,
    lockupDays?: number,
    refundSchedule?: any[],
    isDriverBet?: boolean
  ) => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      if (type === 'MARKET') {
        const { data, error } = await supabase.rpc('create_marketing_campaign_v2', {
          p_title: title,
          p_description: description,
          p_refund_schedule: refundSchedule || [],
          p_is_driver_bet: isDriverBet || false
        });
        
        if (error) throw error;
        if (data && !data.success) throw new Error(data.message);
        
        await refreshEconomy();
        return { success: true, data };
      } else {
        // Legacy/Mission path
        const { data, error } = await supabase.rpc('create_user_campaign', {
          p_type: type,
          p_title: title,
          p_description: description,
          p_reward_min: rewardMin || 0,
          p_reward_max: rewardMax || 0,
          p_yield_rate: yieldRate || 0,
          p_lockup_days: lockupDays || 0
        });
        if (error) throw error;
        await refreshEconomy();
        return { success: true, data };
      }
    } catch (error: any) {
      console.error('Error creating campaign:', error);
      return { success: false, message: error.message || 'Failed to create campaign' };
    }
  };

  const createDriverBet = async (
    title: string,
    description: string,
    sideA: string,
    ticketPrice: number,
    ticketLimit: number,
    endDate: string,
    openDate: string
  ) => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      const { data, error } = await supabase.rpc('create_driver_bet', {
        p_title: title,
        p_description: description,
        p_side_a_name: sideA,
        p_ticket_price: ticketPrice,
        p_ticket_limit: ticketLimit,
        p_official_end_date: endDate,
        p_open_date: openDate
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.message);

      await refreshEconomy();
      return { success: true, data };
    } catch (error: any) {
      console.error('Error creating driver bet:', error);
      return { success: false, message: error.message || 'Failed to create driver bet' };
    }
  };

  const buyDriverBetTicket = async (instrumentId: string, side: 'A' | 'B', quantity: number) => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
        const { data, error } = await supabase.rpc('buy_driver_bet_ticket', {
            p_instrument_id: instrumentId,
            p_side: side,
            p_quantity: quantity
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.message);

        await refreshEconomy();
        return { success: true };
    } catch (error: any) {
        console.error('Error buying driver bet ticket:', error);
        return { success: false, message: error.message || 'Failed to buy ticket' };
    }
  };

  const resolveDriverBet = async (instrumentId: string, winningSide: 'A' | 'B', proofUrl: string) => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
        const { data, error } = await supabase.rpc('resolve_driver_bet', {
            p_instrument_id: instrumentId,
            p_winning_side: winningSide,
            p_proof_url: proofUrl
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.message);

        await refreshEconomy();
        return { success: true };
    } catch (error: any) {
        console.error('Error resolving driver bet:', error);
        return { success: false, message: error.message || 'Failed to resolve bet' };
    }
  };

  const deleteCampaign = async (id: string, mode: 'MARKET' | 'EVERYWHERE') => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      const { data, error } = await supabase.rpc('delete_marketing_campaign', {
        p_instrument_id: id,
        p_mode: mode
      });
      if (error) throw error;
      if (data && !data.success) throw new Error(data.message);
      
      await refreshEconomy();
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting campaign:', error);
      return { success: false, message: error.message || 'Failed to delete campaign' };
    }
  };

  const playReactionGame = async (scoreMs: number) => {
    if (!user) return { success: false, message: 'Not authenticated' };
    try {
      const { data, error } = await supabase.rpc('play_reaction_game', {
        p_score_ms: scoreMs
      });

      if (error) throw error;
      if (data && !data.success) throw new Error(data.message);

      await refreshEconomy();
      return { success: true, reward: data.reward, message: data.message };
    } catch (error: any) {
      console.error('Error playing reaction game:', error);
      return { success: false, message: error.message || 'Failed to submit score' };
    }
  };

  const getMonthlyLeaderboard = async () => {
    try {
        const { data, error } = await supabase.rpc('get_monthly_leaderboard');
        if (error) throw error;
        return { success: true, data };
    } catch (error: any) {
        console.error('Error fetching leaderboard:', error);
        return { success: false, message: error.message };
    }
  };

  const getMonthlyPool = async () => {
    try {
        const { data, error } = await supabase.rpc('get_monthly_prize_pool');
        if (error) throw error;
        return { success: true, data };
    } catch (error: any) {
        console.error('Error fetching pool:', error);
        return { success: false, message: error.message };
    }
  };

  return (
    <EconomyContext.Provider value={{ 
      wallet, 
      ledger, 
      loading, 
      developerStatus,
      refreshEconomy, 
      enterPosition, 
      createTicketListing, 
      purchaseTicketListing,
      claimDailyBonus,
      requestDeveloperAccess,
      approveDeveloperAccess,
      createUserCampaign,
      createDriverBet,
      buyDriverBetTicket,
      resolveDriverBet,
      deleteCampaign,
      playReactionGame,
      getMonthlyLeaderboard,
      getMonthlyPool
    }}>
      {children}
    </EconomyContext.Provider>
  );
};
