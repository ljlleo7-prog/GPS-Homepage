import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { XCircle } from 'lucide-react';

type Interval = '1d' | '1w' | '1m';

interface Point {
  t: string;
  price: number;
}

export default function PriceTrend({
  ticketTypeId,
  title,
  interval,
  onClose,
  onIntervalChange
}: {
  ticketTypeId: string;
  title: string;
  interval: Interval;
  onClose: () => void;
  onIntervalChange: (i: Interval) => void;
}) {
  const [official, setOfficial] = useState<Point[]>([]);
  const [civil, setCivil] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchTrend = async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_ticket_price_trend', {
        p_ticket_type_id: ticketTypeId,
        p_interval: interval
      });
      if (!error && data) {
        setOfficial(data.official || []);
        setCivil(data.civil || []);
      }
      setLoading(false);
    };
    fetchTrend();
  }, [ticketTypeId, interval]);

  const width = 600;
  const height = 220;
  const chartHeight = 180;
  const leftPad = 40;
  const bottomPad = 20;
  const rightPad = 10;
  const topPad = 10;
  const contentWidth = width - leftPad - rightPad;
  const contentHeight = chartHeight - topPad;
  const parseTs = (s: string) => new Date(s).getTime();
  const seriesAll = [...official, ...civil];
  const allPrices = seriesAll.map(p => p.price);
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 1;
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0;
  const allTimes = seriesAll.map(p => parseTs(p.t)).filter(n => !Number.isNaN(n));
  const minTime = allTimes.length ? Math.min(...allTimes) : Date.now();
  const maxTime = allTimes.length ? Math.max(...allTimes) : Date.now();
  const yToSvg = (price: number) => {
    const ratio = (price - minPrice) / Math.max(maxPrice - minPrice, 1);
    return topPad + (contentHeight - ratio * contentHeight);
  };
  const xToSvg = (ts: number) => {
    const ratio = (ts - minTime) / Math.max(maxTime - minTime, 1);
    return leftPad + ratio * contentWidth;
  };
  const ticksYCount = 5;
  const yTicks = Array.from({ length: ticksYCount }, (_, i) => {
    const ratio = i / (ticksYCount - 1);
    const val = minPrice + ratio * (maxPrice - minPrice);
    return { y: yToSvg(val), val };
  });
  const ticksXCount = 6;
  const xTicks = Array.from({ length: ticksXCount }, (_, i) => {
    const ratio = i / (ticksXCount - 1);
    const ts = minTime + ratio * (maxTime - minTime);
    return { x: xToSvg(ts), ts };
  });
  const makePath = (series: Point[]) => {
    if (series.length === 0) return null;
    const d = series
      .map((p, idx) => {
        const cmd = idx === 0 ? 'M' : 'L';
        return `${cmd} ${xToSvg(parseTs(p.t))} ${yToSvg(p.price)}`;
      })
      .join(' ');
    return d;
  };
  const fmt = (n: number) => Number(n).toFixed(2);
  const seriesStats = (series: Point[]) => {
    if (!series.length) return { start: null as number | null, end: null as number | null, min: null as number | null, max: null as number | null };
    const prices = series.map(p => p.price);
    return {
      start: series[0].price,
      end: series[series.length - 1].price,
      min: Math.min(...prices),
      max: Math.max(...prices)
    };
  };
  const offStats = seriesStats(official);
  const civStats = seriesStats(civil);

  return (
    <div className="bg-surface border border-white/10 rounded p-4">
      <div className="flex justify-between items-center mb-2">
        <div className="text-white font-mono text-sm">{title} • Price Trend</div>
        <button onClick={onClose} className="text-white/50 hover:text-white">
          <XCircle size={16} />
        </button>
      </div>
      <div className="flex gap-2 mb-3">
        <button onClick={() => onIntervalChange('1d')} className={`text-xs px-2 py-1 rounded border ${interval==='1d'?'border-primary text-primary bg-primary/10':'border-white/10 text-white/60'}`}>1D</button>
        <button onClick={() => onIntervalChange('1w')} className={`text-xs px-2 py-1 rounded border ${interval==='1w'?'border-primary text-primary bg-primary/10':'border-white/10 text-white/60'}`}>1W</button>
        <button onClick={() => onIntervalChange('1m')} className={`text-xs px-2 py-1 rounded border ${interval==='1m'?'border-primary text-primary bg-primary/10':'border-white/10 text-white/60'}`}>1M</button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div className="text-xs text-white/80">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#60A5FA' }} />
            <span className="font-mono">Official</span>
          </div>
          <div className="font-mono mt-1">
            Start: {offStats.start !== null ? fmt(offStats.start) : '-'} • End: {offStats.end !== null ? fmt(offStats.end) : '-'}
          </div>
          <div className="font-mono">
            High: {offStats.max !== null ? fmt(offStats.max) : '-'} • Low: {offStats.min !== null ? fmt(offStats.min) : '-'}
          </div>
        </div>
        <div className="text-xs text-white/80">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
            <span className="font-mono">Civil</span>
          </div>
          <div className="font-mono mt-1">
            Start: {civStats.start !== null ? fmt(civStats.start) : '-'} • End: {civStats.end !== null ? fmt(civStats.end) : '-'}
          </div>
          <div className="font-mono">
            High: {civStats.max !== null ? fmt(civStats.max) : '-'} • Low: {civStats.min !== null ? fmt(civStats.min) : '-'}
          </div>
        </div>
      </div>
      {loading ? (
        <div className="text-white/60 text-sm">Loading...</div>
      ) : (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          <rect x="0" y="0" width={width} height={height} fill="transparent" />
          {yTicks.map((t, idx) => (
            <g key={`y-${idx}`}>
              <line x1={leftPad} y1={t.y} x2={width - rightPad} y2={t.y} stroke="#ffffff15" />
              <text x={leftPad - 6} y={t.y + 3} fontSize="10" fill="#9CA3AF" textAnchor="end" className="font-mono">{fmt(t.val)}</text>
            </g>
          ))}
          {xTicks.map((t, idx) => (
            <g key={`x-${idx}`}>
              <line x1={t.x} y1={topPad} x2={t.x} y2={topPad + contentHeight} stroke="#ffffff10" />
              <text x={t.x} y={topPad + contentHeight + bottomPad - 2} fontSize="10" fill="#9CA3AF" textAnchor="middle" className="font-mono">
                {new Date(t.ts).toLocaleString()}
              </text>
            </g>
          ))}
          <path d={makePath(official) || ''} stroke="#60A5FA" fill="none" strokeWidth={2} />
          <path d={makePath(civil) || ''} stroke="#F59E0B" fill="none" strokeWidth={2} />
          <text x={leftPad} y={height - 4} fill="#60A5FA" fontSize="10" className="font-mono">Official</text>
          <text x={leftPad + 60} y={height - 4} fill="#F59E0B" fontSize="10" className="font-mono">Civil Avg</text>
        </svg>
      )}
    </div>
  );
}
