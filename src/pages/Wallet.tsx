import { useEconomy } from '../context/EconomyContext';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const Wallet = () => {
  const { wallet, ledger, loading } = useEconomy();
  const { t } = useTranslation();

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
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

        {/* Ledger History */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
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
