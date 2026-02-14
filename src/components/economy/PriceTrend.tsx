import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { XCircle } from 'lucide-react';

type Interval = '1d' | '1w' | '1m';

interface Point {
  t: string;
  price: number;
}

export default function PriceTrend({
  instrumentId,
  ticketTypeAId,
  ticketTypeBId,
  ticketTypeId,
  title,
  interval,
  onClose,
  onIntervalChange
}: {
  instrumentId?: string;
  ticketTypeAId?: string;
  ticketTypeBId?: string;
  ticketTypeId?: string;
  title: string;
  interval: Interval;
  onClose: () => void;
  onIntervalChange: (i: Interval) => void;
}) {
  const [officialA, setOfficialA] = useState<Point[]>([]);
  const [civilA, setCivilA] = useState<Point[]>([]);
  const [officialB, setOfficialB] = useState<Point[]>([]);
  const [civilB, setCivilB] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const [tickNow, setTickNow] = useState<number>(Date.now());
  const [civilSeedA, setCivilSeedA] = useState<number | null>(null);
  const [civilSeedB, setCivilSeedB] = useState<number | null>(null);

  useEffect(() => {
    const fetchTrend = async () => {
      setLoading(true);
      const aId = ticketTypeAId || ticketTypeId;
      if (aId) {
        const { data, error } = await supabase.rpc('get_ticket_price_trend', {
          p_ticket_type_id: aId,
          p_interval: interval
        });
        if (!error && data) {
          setOfficialA(data.official || []);
          setCivilA(data.civil || []);
          if (!data.civil || data.civil.length === 0) {
            const { data: monthData } = await supabase.rpc('get_ticket_price_trend', {
              p_ticket_type_id: aId,
              p_interval: '1m'
            });
            const seed = monthData && monthData.civil && monthData.civil.length ? monthData.civil[monthData.civil.length - 1].price : null;
            setCivilSeedA(seed ?? null);
          } else {
            setCivilSeedA(null);
          }
        } else {
          setOfficialA([]);
          setCivilA([]);
          setCivilSeedA(null);
        }
      } else {
        setOfficialA([]);
        setCivilA([]);
      }
      if (ticketTypeBId) {
        const { data, error } = await supabase.rpc('get_ticket_price_trend', {
          p_ticket_type_id: ticketTypeBId,
          p_interval: interval
        });
        if (!error && data) {
          setOfficialB(data.official || []);
          setCivilB(data.civil || []);
          if (!data.civil || data.civil.length === 0) {
            const { data: monthData } = await supabase.rpc('get_ticket_price_trend', {
              p_ticket_type_id: ticketTypeBId,
              p_interval: '1m'
            });
            const seed = monthData && monthData.civil && monthData.civil.length ? monthData.civil[monthData.civil.length - 1].price : null;
            setCivilSeedB(seed ?? null);
          } else {
            setCivilSeedB(null);
          }
        } else {
          setOfficialB([]);
          setCivilB([]);
          setCivilSeedB(null);
        }
      } else {
        setOfficialB([]);
        setCivilB([]);
      }
      setLoading(false);
    };
    fetchTrend();
    let timer: any = null;
    if (interval === '1d') {
      timer = setInterval(() => {
        setTickNow(Date.now());
        fetchTrend();
      }, 60000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [ticketTypeAId, ticketTypeBId, ticketTypeId, interval]);

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
  const isTodayLocal = (d: Date) => {
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };
  const processSeries = (series: Point[], interval: Interval) => {
    const now = new Date();
    if (interval === '1d') {
      // 1D: Hourly for today (0-23)
      const todaySeries = series
        .map(p => ({ ts: new Date(p.t), price: p.price }))
        .filter(p => isTodayLocal(p.ts))
        .map(p => ({ hour: p.ts.getHours(), price: p.price }))
        .sort((a, b) => a.hour - b.hour);
      const lastByHour: Record<number, number> = {};
      todaySeries.forEach(({ hour, price }) => { lastByHour[hour] = price; });
      const result: { x: number; price: number }[] = [];
      for (let h = 0; h < 24; h++) {
        if (lastByHour[h] !== undefined) {
          result.push({ x: h, price: lastByHour[h] });
        }
      }
      return result;
    } else if (interval === '1w') {
      // 1W: Last 7 days (including today)
      // Map to 0..6 (0 = 6 days ago, 6 = today)
      const result: { x: number; price: number }[] = [];
      const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      
      // Create buckets for last 7 days
      const buckets: Record<string, number> = {}; // key: YYYY-MM-DD
      const targetDates: string[] = [];
      
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const k = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
        targetDates.push(k);
      }

      // Fill buckets with last price of that day
      series.forEach(p => {
        const d = new Date(p.t);
        const k = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
        // We want the latest price for that day, so we just overwrite
        // Assuming series is sorted? If not, we should sort or check timestamp.
        // But usually series is sorted by time.
        // Let's assume series is roughly sorted or we iterate all.
        // To be safe, we can store {price, ts} and compare.
        // For simplicity, assuming series is chronological:
        buckets[k] = p.price;
      });

      // Build result
      targetDates.forEach((k, idx) => {
        if (buckets[k] !== undefined) {
          result.push({ x: idx, price: buckets[k] });
        }
      });
      return result;
    } else {
      // 1M: Current Month days (1..31)
      const result: { x: number; price: number }[] = [];
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      
      // Filter for current month
      const monthSeries = series
        .map(p => ({ ts: new Date(p.t), price: p.price }))
        .filter(p => p.ts.getMonth() === currentMonth && p.ts.getFullYear() === currentYear);
        
      const lastByDay: Record<number, number> = {};
      monthSeries.forEach(({ ts, price }) => {
        lastByDay[ts.getDate()] = price;
      });

      // Get days in month
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        if (lastByDay[d] !== undefined) {
          result.push({ x: d, price: lastByDay[d] });
        }
      }
      return result;
    }
  };

  const getXAxisSettings = (interval: Interval) => {
    const now = new Date();
    if (interval === '1d') {
      return {
        min: 0,
        max: 23,
        ticks: Array.from({ length: 24 }, (_, i) => ({ x: i, label: i.toString().padStart(2, '0') }))
      };
    } else if (interval === '1w') {
      const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const ticks = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        ticks.push({ x: 6 - i, label: days[d.getDay()] });
      }
      return { min: 0, max: 6, ticks };
    } else {
      // 1M
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const ticks = [];
      for (let i = 1; i <= daysInMonth; i++) {
        // Show every 2nd or 3rd day if crowded? 
        // User said "show each day 01, 02...".
        // 31 labels might be crowded. Let's try to show all or filter in rendering.
        // We'll generate all ticks, let SVG rendering decide font size or skip.
        // Actually, for 31 ticks, 600px width is ~20px per tick. Small font (10px) fits.
        ticks.push({ x: i, label: i.toString().padStart(2, '0') });
      }
      return { min: 1, max: daysInMonth, ticks };
    }
  };

  const withCarryForward = (series: { x: number; price: number }[], xMin: number, xMax: number, seed?: number | null) => {
    if (series.length === 0 && (seed == null)) return [];
    const map = new Map<number, number>();
    series.forEach(p => map.set(p.x, p.price));
    const keys = series.map(p => p.x).sort((a, b) => a - b);
    const start = keys.length ? keys[0] : xMin;
    let last = keys.length ? map.get(start)! : (seed as number);
    const out: { x: number; price: number }[] = [];
    for (let x = start; x <= xMax; x++) {
      if (map.has(x)) last = map.get(x)!;
      out.push({ x, price: last });
    }
    return out;
  };

  const seriesAOff = processSeries(officialA, interval);
  const seriesACivRaw = processSeries(civilA, interval);
  const seriesBOff = processSeries(officialB, interval);
  const seriesBCivRaw = processSeries(civilB, interval);
  
  const { min: xMin, max: xMax, ticks: rawXTicks } = getXAxisSettings(interval);
  const seriesACiv = withCarryForward(seriesACivRaw, xMin, xMax, civilSeedA);
  const seriesBCiv = withCarryForward(seriesBCivRaw, xMin, xMax, civilSeedB);
  const allPrices = [...seriesAOff, ...seriesACiv, ...seriesBOff, ...seriesBCiv].map(p => p.price);
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 1;
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0;

  const yToSvg = (price: number) => {
    const ratio = (price - minPrice) / Math.max(maxPrice - minPrice, 0.0001); // avoid div by 0
    return topPad + (contentHeight - ratio * contentHeight);
  };
  
  const xToSvg = (val: number) => {
    const ratio = (val - xMin) / (xMax - xMin || 1);
    return leftPad + ratio * contentWidth;
  };

  const xTicks = rawXTicks.map(t => ({ x: xToSvg(t.x), label: t.label }));
  
  const ticksYCount = 5;
  const yTicks = Array.from({ length: ticksYCount }, (_, i) => {
    const ratio = i / (ticksYCount - 1);
    const val = minPrice + ratio * (maxPrice - minPrice);
    return { y: yToSvg(val), val };
  });

  const makePath = (series: { x: number; price: number }[]) => {
    if (series.length === 0) return '';
    const d = series
      .map((p, idx) => {
        const cmd = idx === 0 ? 'M' : 'L';
        return `${cmd} ${xToSvg(p.x)} ${yToSvg(p.price)}`;
      })
      .join(' ');
    return d;
  };
  
  const fmt = (n: number) => {
    if (n === null || n === undefined || isNaN(Number(n))) return '...';
    const abs = Math.abs(Number(n));
    const intDigits = Math.floor(abs).toString().length;
    const decimals = Math.max(2, Math.max(0, 4 - intDigits));
    return Number(n).toFixed(decimals);
  };
  const seriesStats = (series: { x: number; price: number }[]) => {
    if (!series.length) return { start: null as number | null, end: null as number | null, min: null as number | null, max: null as number | null };
    const prices = series.map(p => p.price);
    return {
      start: series[0].price,
      end: series[series.length - 1].price,
      min: Math.min(...prices),
      max: Math.max(...prices)
    };
  };
  const offStatsA = seriesStats(seriesAOff);
  const civStatsA = seriesStats(seriesACiv);
  const offStatsB = seriesStats(seriesBOff);
  const civStatsB = seriesStats(seriesBCiv);

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
            <span className="font-mono">Official A</span>
          </div>
          <div className="font-mono mt-1">
            Start: {offStatsA.start !== null ? fmt(offStatsA.start) : '-'} • End: {offStatsA.end !== null ? fmt(offStatsA.end) : '-'}
          </div>
          <div className="font-mono">
            High: {offStatsA.max !== null ? fmt(offStatsA.max) : '-'} • Low: {offStatsA.min !== null ? fmt(offStatsA.min) : '-'}
          </div>
        </div>
        <div className="text-xs text-white/80">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
            <span className="font-mono">Civil A</span>
          </div>
          <div className="font-mono mt-1">
            Start: {civStatsA.start !== null ? fmt(civStatsA.start) : '-'} • End: {civStatsA.end !== null ? fmt(civStatsA.end) : '-'}
          </div>
          <div className="font-mono">
            High: {civStatsA.max !== null ? fmt(civStatsA.max) : '-'} • Low: {civStatsA.min !== null ? fmt(civStatsA.min) : '-'}
          </div>
        </div>
        <div className="text-xs text-white/80">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#60A5FA' }} />
            <span className="font-mono">Official B</span>
          </div>
          <div className="font-mono mt-1">
            Start: {offStatsB.start !== null ? fmt(offStatsB.start) : '-'} • End: {offStatsB.end !== null ? fmt(offStatsB.end) : '-'}
          </div>
          <div className="font-mono">
            High: {offStatsB.max !== null ? fmt(offStatsB.max) : '-'} • Low: {offStatsB.min !== null ? fmt(offStatsB.min) : '-'}
          </div>
        </div>
        <div className="text-xs text-white/80">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
            <span className="font-mono">Civil B</span>
          </div>
          <div className="font-mono mt-1">
            Start: {civStatsB.start !== null ? fmt(civStatsB.start) : '-'} • End: {civStatsB.end !== null ? fmt(civStatsB.end) : '-'}
          </div>
          <div className="font-mono">
            High: {civStatsB.max !== null ? fmt(civStatsB.max) : '-'} • Low: {civStatsB.min !== null ? fmt(civStatsB.min) : '-'}
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
              <text x={t.x} y={topPad + contentHeight + bottomPad - 2} fontSize="10" fill="#9CA3AF" textAnchor="middle" className="font-mono">{t.label}</text>
            </g>
          ))}
          <path d={makePath(seriesAOff)} stroke="#60A5FA" fill="none" strokeWidth={2} />
          <path d={makePath(seriesACiv)} stroke="#F59E0B" fill="none" strokeWidth={2} />
          <path d={makePath(seriesBOff)} stroke="#60A5FA" fill="none" strokeWidth={2} strokeDasharray="6,4" />
          <path d={makePath(seriesBCiv)} stroke="#F59E0B" fill="none" strokeWidth={2} strokeDasharray="6,4" />
          <text x={leftPad} y={height - 4} fill="#60A5FA" fontSize="10" className="font-mono">Official A</text>
          <text x={leftPad + 80} y={height - 4} fill="#60A5FA" fontSize="10" className="font-mono">Official B</text>
          <text x={leftPad + 180} y={height - 4} fill="#F59E0B" fontSize="10" className="font-mono">Civil A</text>
          <text x={leftPad + 260} y={height - 4} fill="#F59E0B" fontSize="10" className="font-mono">Civil B</text>
        </svg>
      )}
    </div>
  );
}
