import { useTranslation } from 'react-i18next';
import type { Role } from '@/types/deduction';
import type { LocalPlayer, SuspicionMap, SharedKnowledge, DiscussionMessage, BotPrivateKnowledge, RoleCertaintyMap } from './types';

interface DevPanelProps {
  players: LocalPlayer[];
  suspicions: SuspicionMap;
  sharedKnowledge: SharedKnowledge;
  gameLog: DiscussionMessage[];
  botPrivateKnowledge: Record<string, BotPrivateKnowledge>;
  roleCertainty: RoleCertaintyMap;
  evaluateBotTargets: (bot: LocalPlayer, players: LocalPlayer[], suspicions: SuspicionMap, knowledge: SharedKnowledge, log: DiscussionMessage[], botPrivateKnowledge?: Record<string, BotPrivateKnowledge>) => Array<{
    target: LocalPlayer;
    publicScore: number;
    privateScore: number;
    totalScore: number;
    publicReason: 'race' | 'claim' | 'pressure' | 'vote' | 'uncertain';
    shouldBusTeammate: boolean;
  }>;
}

export default function DevPanel({ players, suspicions, sharedKnowledge, gameLog, botPrivateKnowledge, roleCertainty, evaluateBotTargets }: DevPanelProps) {
  const { t } = useTranslation();
  const cell = (v: number | null) => v === null ? <span className="text-gray-700">—</span> : <span className={v >= 70 ? 'text-red-400' : v >= 40 ? 'text-yellow-400' : 'text-gray-500'}>{v}</span>;

  return (
    <div className="mb-4 bg-neutral-950 border border-amber-500/20 rounded-lg p-2 overflow-x-auto">
      <h3 className="text-[10px] font-bold text-amber-400 mb-2">{t('deduction_game.dev.title')}</h3>

      <div className="text-[10px] font-bold text-gray-400 mb-1">Bot Evaluations</div>
      <table className="text-[9px] border-collapse mb-2">
        <thead>
          <tr className="text-gray-500">
            <th className="pr-1 text-left sticky left-0 bg-neutral-950">Tgt</th>
            {players.filter((p) => !p.isHuman && p.isAlive).map((bot) => (
              <th key={bot.id} colSpan={9} className="pr-1 border-l border-gray-700">#{bot.number} {bot.name.slice(0, 3)}</th>
            ))}
          </tr>
          <tr className="text-gray-600">
            <th className="pr-1 sticky left-0 bg-neutral-950"></th>
            {players.filter((p) => !p.isHuman && p.isAlive).map((bot) => (
              <>
                <th key={`${bot.id}-s`} className="pr-1 border-l border-gray-700">S</th>
                <th key={`${bot.id}-pb`} className="pr-1">Pb</th>
                <th key={`${bot.id}-pv`} className="pr-1">Pv</th>
                <th key={`${bot.id}-t`} className="pr-1">T</th>
                <th key={`${bot.id}-r`} className="pr-1">R</th>
                <th key={`${bot.id}-tp`} className="pr-1">TP</th>
                <th key={`${bot.id}-tc`} className="pr-1">TC</th>
                <th key={`${bot.id}-is`} className="pr-1">IS</th>
                <th key={`${bot.id}-st`} className="pr-1">ST</th>
              </>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.filter((p) => p.isAlive).map((target) => (
            <tr key={target.id} className={target.isHuman ? 'text-blue-300' : ''}>
              <td className="pr-1 sticky left-0 bg-neutral-950">#{target.number}</td>
              {players.filter((p) => !p.isHuman && p.isAlive).map((bot) => {
                if (bot.id === target.id) {
                  return (
                    <>
                      <td key={`${bot.id}-s`} className="pr-1 text-center border-l border-gray-800">{cell(null)}</td>
                      <td key={`${bot.id}-pb`} className="pr-1 text-center">{cell(null)}</td>
                      <td key={`${bot.id}-pv`} className="pr-1 text-center">{cell(null)}</td>
                      <td key={`${bot.id}-t`} className="pr-1 text-center">{cell(null)}</td>
                      <td key={`${bot.id}-r`} className="pr-1 text-center text-gray-700">—</td>
                      <td key={`${bot.id}-tp`} className="pr-1 text-center">{cell(null)}</td>
                      <td key={`${bot.id}-tc`} className="pr-1 text-center">{cell(null)}</td>
                      <td key={`${bot.id}-is`} className="pr-1 text-center">{cell(null)}</td>
                      <td key={`${bot.id}-st`} className="pr-1 text-center">{cell(null)}</td>
                    </>
                  );
                }
                const evals = evaluateBotTargets(bot, players, suspicions, sharedKnowledge, gameLog, botPrivateKnowledge);
                const evaluation = evals.find((e) => e.target.id === target.id);
                const rc = roleCertainty[bot.id]?.[target.id] ?? {};
                const sus = suspicions[bot.id]?.[target.id] ?? 0;
                return (
                  <>
                    <td key={`${bot.id}-s`} className="pr-1 text-center border-l border-gray-800">{cell(sus)}</td>
                    <td key={`${bot.id}-pb`} className="pr-1 text-center">{cell(evaluation?.publicScore ?? 0)}</td>
                    <td key={`${bot.id}-pv`} className="pr-1 text-center">{evaluation ? <>{cell(Math.abs(evaluation.privateScore))}{evaluation.privateScore < 0 ? '↓' : evaluation.privateScore > 0 ? '↑' : ''}</> : cell(0)}</td>
                    <td key={`${bot.id}-t`} className="pr-1 text-center">{cell(evaluation?.totalScore ?? 0)}</td>
                    <td key={`${bot.id}-r`} className="pr-1 text-center text-gray-400">{evaluation?.publicReason?.slice(0, 3) ?? '—'}</td>
                    <td key={`${bot.id}-tp`} className="pr-1 text-center">{cell(rc['TP'] ?? 0)}</td>
                    <td key={`${bot.id}-tc`} className="pr-1 text-center">{cell(rc['TC'] ?? 0)}</td>
                    <td key={`${bot.id}-is`} className="pr-1 text-center">{cell(rc['IS'] ?? 0)}</td>
                    <td key={`${bot.id}-st`} className="pr-1 text-center">{cell(rc['ST'] ?? 0)}</td>
                  </>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex gap-3 overflow-x-auto">
        <div className="flex-shrink-0">
          <div className="text-[10px] font-bold text-gray-400 mb-1">{t('deduction_game.dev.grid_sus')}</div>
          <table className="text-[9px] border-collapse">
            <thead>
              <tr>
                <th className="pr-1 text-gray-500">↓\→</th>
                {players.filter((p) => p.isAlive).map((p) => <th key={p.id} className="pr-1 text-gray-500">#{p.number}</th>)}
              </tr>
            </thead>
            <tbody>
              {players.filter((p) => !p.isHuman && p.isAlive).map((obs) => (
                <tr key={obs.id}>
                  <td className="pr-1 text-gray-400">#{obs.number}</td>
                  {players.filter((p) => p.isAlive).map((tgt) => {
                    const v = tgt.id === obs.id ? null : (suspicions[obs.id]?.[tgt.id] ?? null);
                    return <td key={tgt.id} className="pr-1 text-center">{v === null ? <span className="text-gray-700">—</span> : <span className={v >= 70 ? 'text-red-400' : v >= 40 ? 'text-yellow-400' : 'text-gray-500'}>{v}</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(['TP', 'TC', 'IS', 'ST'] as Role[]).map((role) => (
          <div key={role} className="flex-shrink-0">
            <div className="text-[10px] text-gray-500 mb-1">{role}</div>
            <table className="text-[9px] border-collapse">
              <thead>
                <tr>
                  <th className="pr-1 text-gray-600">↓\→</th>
                  {players.filter((p) => p.isAlive).map((p) => <th key={p.id} className="pr-1 text-gray-600">#{p.number}</th>)}
                </tr>
              </thead>
              <tbody>
                {players.filter((p) => !p.isHuman && p.isAlive).map((obs) => (
                  <tr key={obs.id}>
                    <td className="pr-1 text-gray-500">#{obs.number}</td>
                    {players.filter((p) => p.isAlive).map((tgt) => {
                      const v = tgt.id === obs.id ? null : (roleCertainty[obs.id]?.[tgt.id]?.[role] ?? null);
                      return <td key={tgt.id} className="pr-1 text-center">{v === null ? <span className="text-gray-700">—</span> : <span className={v >= 70 ? 'text-red-400' : v >= 40 ? 'text-yellow-400' : 'text-gray-600'}>{v}</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
