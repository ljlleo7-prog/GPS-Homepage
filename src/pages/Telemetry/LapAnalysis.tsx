import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTelemetryStore } from '../../store/telemetryStore';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const darkenHexColor = (hexColor: string, factor: number) => {
  const normalized = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hexColor;
  const safeFactor = clamp(factor, 0.45, 1);
  const r = Math.round(parseInt(normalized.slice(0, 2), 16) * safeFactor);
  const g = Math.round(parseInt(normalized.slice(2, 4), 16) * safeFactor);
  const b = Math.round(parseInt(normalized.slice(4, 6), 16) * safeFactor);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

const LapAnalysis = () => {
  const { t } = useTranslation();
  const { 
    selectedSessionKey, 
    selectedDriverNumbers, 
    lapCache, 
    fetchLaps,
    drivers
  } = useTelemetryStore();
  const [comparisonDrivers, setComparisonDrivers] = useState<number[]>([]);

  useEffect(() => {
    if (!selectedSessionKey || selectedDriverNumbers.length === 0) return;

    selectedDriverNumbers.forEach(driverNum => {
      // Fetch laps once per selected driver when tab is opened
      fetchLaps(selectedSessionKey, driverNum);
    });
  }, [selectedSessionKey, selectedDriverNumbers, fetchLaps]);

  useEffect(() => {
    setComparisonDrivers((prev) => {
      const availableDriverNumbers = new Set(drivers.map((driver) => driver.driver_number));
      const merged = Array.from(new Set([...selectedDriverNumbers, ...prev])).filter((driverNumber) =>
        availableDriverNumbers.has(driverNumber)
      );
      return merged;
    });
  }, [selectedDriverNumbers, drivers]);

  useEffect(() => {
    if (!selectedSessionKey || comparisonDrivers.length === 0) return;
    comparisonDrivers.forEach((driverNum) => {
      fetchLaps(selectedSessionKey, driverNum);
    });
  }, [selectedSessionKey, comparisonDrivers, fetchLaps]);

  const getDriverName = (driverNumber: number) => {
    const driver = drivers.find(d => d.driver_number === driverNumber);
    return driver ? driver.name_acronym : `Driver ${driverNumber}`;
  };

  const getDriverColor = (driverNumber: number) => {
    const driver = drivers.find(d => d.driver_number === driverNumber);
    return driver ? `#${driver.team_colour}` : '#ffffff';
  };

  const comparisonDriverColorMap = useMemo(() => {
    const teamBuckets = new Map<string, number[]>();
    comparisonDrivers.forEach((driverNumber) => {
      const driver = drivers.find((item) => item.driver_number === driverNumber);
      if (!driver) return;
      const teamKey = `${driver.team_name}_${driver.team_colour}`;
      const bucket = teamBuckets.get(teamKey) || [];
      bucket.push(driverNumber);
      teamBuckets.set(teamKey, bucket);
    });
    const colorMap = new Map<number, string>();
    teamBuckets.forEach((bucket) => {
      const sortedBucket = [...bucket].sort((a, b) => a - b);
      sortedBucket.forEach((driverNumber, index) => {
        const driver = drivers.find((item) => item.driver_number === driverNumber);
        const baseColor = driver ? `#${driver.team_colour}` : '#ffffff';
        const factor = Math.max(1 - index * 0.2, 0.45);
        colorMap.set(driverNumber, darkenHexColor(baseColor, factor));
      });
    });
    return colorMap;
  }, [comparisonDrivers, drivers]);

  const getComparisonDriverColor = (driverNumber: number) => {
    return comparisonDriverColorMap.get(driverNumber) || getDriverColor(driverNumber);
  };

  const formatLapSeconds = (value: number | null | undefined) => {
    if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return 'N/A';
    const minutes = Math.floor(value / 60);
    const seconds = value - minutes * 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  };

  const comparisonChartData = useMemo(() => {
    if (!selectedSessionKey || comparisonDrivers.length === 0) return [];

    const driverSeriesMap = new Map<number, Map<number, number | null>>();
    const lapNumbers = new Set<number>();

    comparisonDrivers.forEach((driverNumber) => {
      const laps = (lapCache[selectedSessionKey]?.[driverNumber] || [])
        .filter((lap) => Number.isFinite(lap.lap_duration) && lap.lap_duration > 0)
        .sort((a, b) => a.lap_number - b.lap_number);
      if (laps.length === 0) return;

      const personalBest = laps.reduce((best, lap) => Math.min(best, lap.lap_duration), Number.POSITIVE_INFINITY);
      if (!Number.isFinite(personalBest) || personalBest <= 0) return;
      const maxValidDuration = personalBest * 1.1;
      const lapMap = new Map<number, number | null>();

      laps.forEach((lap) => {
        lapNumbers.add(lap.lap_number);
        const value = lap.lap_duration > maxValidDuration ? null : lap.lap_duration;
        lapMap.set(lap.lap_number, value);
      });

      driverSeriesMap.set(driverNumber, lapMap);
    });

    return Array.from(lapNumbers)
      .sort((a, b) => a - b)
      .map((lapNumber) => {
        const row: Record<string, number | null> = { lap: lapNumber };
        comparisonDrivers.forEach((driverNumber) => {
          const key = `driver_${driverNumber}`;
          row[key] = driverSeriesMap.get(driverNumber)?.get(lapNumber) ?? null;
        });
        return row;
      });
  }, [selectedSessionKey, comparisonDrivers, lapCache]);

  const comparisonYDomain = useMemo<[number, number] | ['auto', 'auto']>(() => {
    if (comparisonChartData.length === 0 || comparisonDrivers.length === 0) return ['auto', 'auto'];
    const values: number[] = [];
    comparisonChartData.forEach((row) => {
      comparisonDrivers.forEach((driverNumber) => {
        const value = row[`driver_${driverNumber}`];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          values.push(value);
        }
      });
    });
    if (values.length === 0) return ['auto', 'auto'];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max <= min) {
      return [Math.max(0, min - 0.5), max + 0.5];
    }
    const padding = Math.max((max - min) * 0.08, 0.2);
    return [Math.max(0, min - padding), max + padding];
  }, [comparisonChartData, comparisonDrivers]);

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-white font-mono font-bold mb-6">
        {t('telemetry.laps.title', 'Lap Time Analysis')}
      </h3>

      <div className="mb-6 rounded-lg border border-white/5 bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="text-sm font-mono text-white">
            {t('telemetry.laps.compare_title', 'Lap Time Progress Comparison')}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-2.5 py-1.5 rounded border border-white/10 text-xs font-mono text-text-secondary hover:border-primary/50 hover:text-white"
              onClick={() => setComparisonDrivers(drivers.map((driver) => driver.driver_number))}
            >
              {t('telemetry.laps.select_all_drivers', 'Select all')}
            </button>
            <button
              className="px-2.5 py-1.5 rounded border border-white/10 text-xs font-mono text-text-secondary hover:border-primary/50 hover:text-white"
              onClick={() => setComparisonDrivers([])}
            >
              {t('telemetry.laps.clear_all_drivers', 'Clear')}
            </button>
          </div>
        </div>

        <div className="mb-4 max-h-[130px] overflow-y-auto pr-1 custom-scrollbar grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
          {drivers.map((driver) => {
            const selected = comparisonDrivers.includes(driver.driver_number);
            return (
              <button
                key={driver.driver_number}
                onClick={() =>
                  setComparisonDrivers((prev) =>
                    prev.includes(driver.driver_number)
                      ? prev.filter((item) => item !== driver.driver_number)
                      : [...prev, driver.driver_number]
                  )
                }
                className={`px-2.5 py-2 rounded border text-left text-xs font-mono transition-colors ${
                  selected
                    ? 'border-primary/60 bg-primary/10 text-white'
                    : 'border-white/10 text-text-secondary hover:border-primary/50 hover:text-white'
                }`}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ backgroundColor: getComparisonDriverColor(driver.driver_number) }} />
                {driver.name_acronym} {driver.driver_number}
              </button>
            );
          })}
        </div>

        <div className="h-[320px]">
          {comparisonDrivers.length === 0 ? (
            <div className="h-full flex items-center justify-center text-text-secondary text-sm font-mono">
              {t('telemetry.laps.select_compare_drivers', 'Select one or more drivers to compare lap progress.')}
            </div>
          ) : comparisonChartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-text-secondary text-sm font-mono">
              {t('telemetry.laps.no_compare_data', 'No lap data available for selected drivers.')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparisonChartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="lap"
                  type="number"
                  allowDecimals={false}
                  domain={['dataMin', 'dataMax']}
                  tick={{ fill: '#9ca3af', fontSize: 11, fontFamily: 'monospace' }}
                  label={{ value: t('telemetry.laps.lap_number', 'Lap'), position: 'insideBottom', fill: '#9ca3af', fontSize: 11 }}
                />
                <YAxis
                  domain={comparisonYDomain}
                  tick={{ fill: '#9ca3af', fontSize: 11, fontFamily: 'monospace' }}
                  tickFormatter={(value) => formatLapSeconds(Number(value))}
                  label={{ value: t('telemetry.laps.lap_time', 'Lap Time'), angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value: number | string) => [formatLapSeconds(typeof value === 'number' ? value : Number(value)), t('telemetry.laps.time', 'Time')]}
                  labelFormatter={(label: number | string) => `${t('telemetry.laps.lap', 'Lap')} ${label}`}
                  contentStyle={{
                    backgroundColor: 'rgba(10,10,10,0.92)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontFamily: 'monospace',
                    fontSize: '12px'
                  }}
                />
                <Legend wrapperStyle={{ fontFamily: 'monospace', fontSize: 12 }} />
                {comparisonDrivers.map((driverNumber) => (
                  <Line
                    key={driverNumber}
                    type="monotone"
                    dataKey={`driver_${driverNumber}`}
                    name={`${getDriverName(driverNumber)} #${driverNumber}`}
                    stroke={getComparisonDriverColor(driverNumber)}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {selectedDriverNumbers.map(driverNum => {
          const laps = lapCache[selectedSessionKey!]?.[driverNum] || [];
          
          return (
            <div key={driverNum} className="bg-background rounded-lg border border-white/5 overflow-hidden flex flex-col">
              <div 
                className="px-4 py-2 border-b border-white/5 flex items-center justify-between"
                style={{ borderTop: `3px solid ${getDriverColor(driverNum)}` }}
              >
                <span className="font-mono font-bold text-white">{getDriverName(driverNum)}</span>
                <span className="text-xs text-text-secondary font-mono">{laps.length} Laps</span>
              </div>
              
              <div className="flex-1 overflow-y-auto max-h-[400px] custom-scrollbar">
                {laps.length === 0 ? (
                  <div className="p-4 text-center text-text-secondary text-sm font-mono">
                    No lap data available.
                  </div>
                ) : (
                  <table className="w-full text-sm font-mono">
                    <thead className="bg-surface sticky top-0 text-text-secondary">
                      <tr>
                        <th className="py-2 px-4 text-left font-normal">Lap</th>
                        <th className="py-2 px-4 text-right font-normal">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {laps.map((lap, index) => (
                        <tr key={index} className="border-t border-white/5 hover:bg-white/5">
                          <td className="py-2 px-4 text-text-secondary">{lap.lap_number}</td>
                          <td className="py-2 px-4 text-right text-white">
                            {lap.lap_duration ? lap.lap_duration.toFixed(3) : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LapAnalysis;
