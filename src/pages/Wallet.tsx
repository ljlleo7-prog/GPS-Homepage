import { useEconomy } from '../context/EconomyContext';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Gift, Lock, Shield, UserCheck, Activity, Star } from 'lucide-react';
import { useState } from 'react';

const Wallet = () => {
  const { wallet, ledger, loading, developerStatus, claimDailyBonus, requestDeveloperAccess } = useEconomy();
  const { t } = useTranslation();
  const [claiming, setClaiming] = useState(false);
  const [requesting, setRequesting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-background pt-24 text-center text-white">
        Loading Wallet...
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="min-h-screen bg-background pt-24 text-center text-white">
        Please log in to view your wallet.
      </div>
    );
  }

  const isBonusClaimedToday = wallet.last_daily_bonus && 
    new Date(wallet.last_daily_bonus).toDateString() === new Date().toDateString();

  const handleClaimBonus = async () => {
    setClaiming(true);
    const result = await claimDailyBonus();
    if (result.success) {
      alert(`Claimed ${result.amount} Tokens!`);
    } else {
      alert(result.message);
    }
    setClaiming(false);
  };

  const handleRequestDev = async () => {
    if (!confirm('Request developer status? This will set your Reputation to 80 upon approval.')) return;
    setRequesting(true);
    const result = await requestDeveloperAccess();
    if (result.success) {
      alert('Request sent successfully!');
    } else {
      alert(result.message);
    }
    setRequesting(false);
  };

  const reputation = wallet.reputation_balance;

  return (
    <div className="min-h-screen bg-background pt-24 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-bold font-mono mb-8 text-white"
        >
          My Wallet
        </motion.h1>

        {/* Balances */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-surface border border-white/10 rounded-lg p-6"
          >
            <h2 className="text-sm font-mono text-text-secondary uppercase tracking-wider mb-2">Tokens</h2>
            <div className="text-4xl font-bold text-primary font-mono">
              {wallet.token_balance} <span className="text-lg">TKN</span>
            </div>
            <p className="text-xs text-text-secondary mt-2">Transferable currency for markets.</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-surface border border-white/10 rounded-lg p-6"
          >
            <h2 className="text-sm font-mono text-text-secondary uppercase tracking-wider mb-2">Reputation</h2>
            <div className="text-4xl font-bold text-secondary font-mono">
              {wallet.reputation_balance} <span className="text-lg">REP</span>
            </div>
            <p className="text-xs text-text-secondary mt-2">Non-transferable. Earned by contribution.</p>
          </motion.div>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* Daily Bonus */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-surface border border-white/10 rounded-lg p-6 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Gift size={64} />
            </div>
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <Gift size={20} className="text-primary" />
              {t('economy.wallet.daily_bonus.title')}
            </h3>
            <p className="text-sm text-text-secondary mb-4">{t('economy.wallet.daily_bonus.desc')}</p>
            
            {isBonusClaimedToday ? (
              <div className="bg-white/5 rounded p-3 text-center border border-white/10">
                <p className="text-green-400 font-bold mb-1">{t('economy.wallet.daily_bonus.claimed')}</p>
                <p className="text-xs text-text-secondary">{t('economy.wallet.daily_bonus.next')}</p>
              </div>
            ) : (
              <button
                onClick={handleClaimBonus}
                disabled={claiming}
                className="w-full bg-primary text-background font-bold py-2 rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {claiming ? 'Claiming...' : t('economy.wallet.daily_bonus.claim')}
              </button>
            )}
          </motion.div>

          {/* Developer Status */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-surface border border-white/10 rounded-lg p-6 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Shield size={64} />
            </div>
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <Shield size={20} className="text-secondary" />
              {t('economy.wallet.developer.title')}
            </h3>
            <p className="text-sm text-text-secondary mb-4">{t('economy.wallet.developer.desc')}</p>
            
            {developerStatus === 'APPROVED' ? (
              <div className="bg-green-500/10 border border-green-500/30 rounded p-3 text-center">
                <p className="text-green-400 font-bold flex items-center justify-center gap-2">
                  <UserCheck size={16} />
                  {t('economy.wallet.developer.approved')}
                </p>
              </div>
            ) : developerStatus === 'PENDING' ? (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-center">
                <p className="text-yellow-400 font-bold">
                  {t('economy.wallet.developer.pending')}
                </p>
              </div>
            ) : (
              <button
                onClick={handleRequestDev}
                disabled={requesting}
                className="w-full bg-secondary text-background font-bold py-2 rounded hover:bg-secondary/90 transition-colors disabled:opacity-50"
              >
                {requesting ? 'Sending...' : t('economy.wallet.developer.request')}
              </button>
            )}
          </motion.div>
        </div>

        {/* Reputation Tiers */}
        <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.3 }}
           className="mb-12 bg-surface border border-white/10 rounded-lg p-6"
        >
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Star size={20} className="text-yellow-400" />
            {t('economy.wallet.tiers.title')}
          </h3>
          <div className="space-y-3">
            <div className={`flex items-center gap-3 p-3 rounded border ${reputation > 30 ? 'bg-primary/10 border-primary/30' : 'bg-white/5 border-white/10 opacity-50'}`}>
              <div className={`w-3 h-3 rounded-full ${reputation > 30 ? 'bg-primary' : 'bg-white/20'}`} />
              <span className={reputation > 30 ? 'text-white' : 'text-text-secondary'}>
                {t('economy.wallet.tiers.level1')}
              </span>
              {reputation > 30 && <span className="ml-auto text-xs text-primary font-bold">UNLOCKED</span>}
            </div>
            <div className={`flex items-center gap-3 p-3 rounded border ${reputation > 50 ? 'bg-primary/10 border-primary/30' : 'bg-white/5 border-white/10 opacity-50'}`}>
              <div className={`w-3 h-3 rounded-full ${reputation > 50 ? 'bg-primary' : 'bg-white/20'}`} />
              <span className={reputation > 50 ? 'text-white' : 'text-text-secondary'}>
                {t('economy.wallet.tiers.level2')}
              </span>
              {reputation > 50 && <span className="ml-auto text-xs text-primary font-bold">UNLOCKED</span>}
            </div>
            <div className={`flex items-center gap-3 p-3 rounded border ${reputation > 70 ? 'bg-primary/10 border-primary/30' : 'bg-white/5 border-white/10 opacity-50'}`}>
              <div className={`w-3 h-3 rounded-full ${reputation > 70 ? 'bg-primary' : 'bg-white/20'}`} />
              <span className={reputation > 70 ? 'text-white' : 'text-text-secondary'}>
                {t('economy.wallet.tiers.level3')}
              </span>
              {reputation > 70 && <span className="ml-auto text-xs text-primary font-bold">UNLOCKED</span>}
            </div>
          </div>
        </motion.div>

        {/* Ledger History */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-surface border border-white/10 rounded-lg overflow-hidden"
        >
          <div className="p-6 border-b border-white/10">
            <h2 className="text-xl font-bold text-white font-mono">Transaction History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-text-secondary font-mono uppercase">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Description</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {ledger.map((entry) => (
                  <tr key={entry.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 font-mono text-text-secondary">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 font-mono text-primary">
                      {entry.operation_type}
                    </td>
                    <td className="px-6 py-4 text-white">
                      {entry.description || '-'}
                    </td>
                    <td className={`px-6 py-4 text-right font-mono font-bold ${entry.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {entry.amount > 0 ? '+' : ''}{entry.amount} {entry.currency}
                    </td>
                  </tr>
                ))}
                {ledger.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-text-secondary">
                      No transactions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Wallet;