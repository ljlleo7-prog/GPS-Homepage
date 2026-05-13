import { useTranslation } from 'react-i18next';

interface ManualProps {
  onClose: () => void;
}

export default function Manual({ onClose }: ManualProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-start justify-center overflow-y-auto p-4 pt-20">
      <div className="bg-neutral-900 border border-white/10 rounded-xl max-w-2xl w-full p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white text-lg">✕</button>
        <h2 className="text-xl font-bold mb-4">{t('deduction_game.manual.title')}</h2>
        <p className="text-sm text-gray-300 mb-4">{t('deduction_game.manual.overview')}</p>

        <h3 className="text-sm font-bold text-purple-400 mb-2">{t('deduction_game.manual.phases_title')}</h3>
        <ul className="text-xs text-gray-300 space-y-1 mb-4">
          {(['night', 'discussion', 'voting', 'race'] as const).map((phase) => (
            <li key={phase}><span className="text-white font-bold">{t(`deduction_game.manual.phase_${phase}_name`)}</span> — {t(`deduction_game.manual.phase_${phase}`)}</li>
          ))}
        </ul>

        <h3 className="text-sm font-bold text-cyan-400 mb-2">{t('deduction_game.manual.roles_title')}</h3>
        <div className="space-y-2 mb-4">
          {(['TP_pos', 'TP_neg', 'TC_pos', 'TC_neg', 'IS_pos', 'IS_neg', 'ST_pos', 'ST_neg'] as const).map((key) => (
            <div key={key} className="text-xs">
              <span className={`font-bold ${key.endsWith('neg') ? 'text-red-400' : 'text-green-400'}`}>{key.replace('_pos', '+').replace('_neg', '-')}</span>
              <span className="text-gray-300 ml-2">{t(`deduction_game.manual.role_${key}`)}</span>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-bold text-amber-400 mb-2">{t('deduction_game.manual.bots_title')}</h3>
        <ul className="text-xs text-gray-300 space-y-1">
          {(['overview', 'scoring', 'voting', 'speech'] as const).map((key) => (
            <li key={key}>{t(`deduction_game.manual.bot_${key}`)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
