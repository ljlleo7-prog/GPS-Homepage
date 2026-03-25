import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { useTelemetryStore } from '../../store/telemetryStore';
import { format, parseISO } from 'date-fns';

interface TelemetryChartProps {
  liveMode: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const darkenHexColor = (hexColor: string, factor: number) => {
  const normalized = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hexColor;
  const safeFactor = clamp(factor, 0.35, 1);
  const r = Math.round(parseInt(normalized.slice(0, 2), 16) * safeFactor);
  const g = Math.round(parseInt(normalized.slice(2, 4), 16) * safeFactor);
  const b = Math.round(parseInt(normalized.slice(4, 6), 16) * safeFactor);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

const TelemetryChart = ({ liveMode }: TelemetryChartProps) => {
  const { t } = useTranslation();
  const { 
    selectedSessionKey, 
    selectedDriverNumbers, 
    telemetryCache, 
    telemetryLoadState,
    fetchTelemetry,
    lapCache,
    fetchLaps,
    drivers,
    interpolation
  } = useTelemetryStore();

  const [metric, setMetric] = useState<'speed' | 'rpm' | 'throttle' | 'brake' | 'n_gear'>('speed');
  const [viewMode, setViewMode] = useState<'latest' | 'lap_compare'>('latest');
  const [selectedLapSeries, setSelectedLapSeries] = useState<string[]>([]);
  const POSITION_BUCKET_STEP = 0.5;
  const shouldInterpolateMetric = interpolation.enabled && interpolation.metrics[metric];

  const getDriverColor = (driverNumber: number) => {
    const driver = drivers.find(d => d.driver_number === driverNumber);
    return driver ? `#${driver.team_colour}` : '#ffffff';
  };

  const getDriverName = (driverNumber: number) => {
    const driver = drivers.find(d => d.driver_number === driverNumber);
    return driver ? driver.name_acronym : `Driver ${driverNumber}`;
  };

  // Fetch laps so we can populate the lap selector
  useEffect(() => {
    if (!selectedSessionKey || selectedDriverNumbers.length === 0) return;
    selectedDriverNumbers.forEach(driverNum => {
      fetchLaps(selectedSessionKey, driverNum);
    });
  }, [selectedSessionKey, selectedDriverNumbers, fetchLaps]);

  const lapSeriesOptions = useMemo(() => {
    if (!selectedSessionKey || selectedDriverNumbers.length === 0) return [];
    return selectedDriverNumbers
      .flatMap((driverNumber) => {
        const driverLaps = lapCache[selectedSessionKey]?.[driverNumber] || [];
        return driverLaps
          .filter((lap) => Boolean(lap.date_start) && Boolean(lap.lap_duration))
          .map((lap) => {
            const key = `${driverNumber}_${lap.lap_number}`;
            const driver = drivers.find((item) => item.driver_number === driverNumber);
            const driverName = driver ? driver.name_acronym : `Driver ${driverNumber}`;
            return {
              key,
              driverNumber,
              lapNumber: lap.lap_number,
              label: `${driverName} · Lap ${lap.lap_number}`
            };
          });
      })
      .sort((a, b) => {
        if (a.driverNumber !== b.driverNumber) return a.driverNumber - b.driverNumber;
        return a.lapNumber - b.lapNumber;
      });
  }, [selectedSessionKey, selectedDriverNumbers, lapCache, drivers]);

  useEffect(() => {
    if (!selectedSessionKey || lapSeriesOptions.length === 0) {
      setSelectedLapSeries([]);
      return;
    }
    const optionKeys = new Set(lapSeriesOptions.map((option) => option.key));
    setSelectedLapSeries((prev) => {
      const filtered = prev.filter((key) => optionKeys.has(key));
      if (filtered.length > 0) return filtered;
      return lapSeriesOptions.slice(-Math.min(2, lapSeriesOptions.length)).map((option) => option.key);
    });
  }, [selectedSessionKey, lapSeriesOptions]);

  // Fetch data periodically if liveMode is on, or just once if off
  useEffect(() => {
    if (!selectedSessionKey || selectedDriverNumbers.length === 0) return;

    const fetchAll = () => {
      selectedDriverNumbers.forEach(driverNum => {
        fetchTelemetry(selectedSessionKey, driverNum, liveMode);
      });
    };

    // Initial fetch
    fetchAll();

    let interval: NodeJS.Timeout;
    if (liveMode && viewMode === 'latest') {
      interval = setInterval(fetchAll, 3000); // poll every 3 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedSessionKey, selectedDriverNumbers, liveMode, fetchTelemetry, viewMode]);

  // Transform cache data for recharts
  // We need to merge data from multiple drivers by time (date)
  const chartData = useMemo(() => {
    if (!selectedSessionKey || selectedDriverNumbers.length === 0) return [];
    
    if (viewMode === 'latest') {
      const timeMap: Record<string, Record<string, string | number>> = {};
      selectedDriverNumbers.forEach(driverNumber => {
        const MAX_POINTS = 200;
        const data = (telemetryCache[selectedSessionKey]?.[driverNumber] || []).slice(-MAX_POINTS);
        data.forEach(point => {
          const timeKey = point.date;
          if (!timeMap[timeKey]) {
            timeMap[timeKey] = {
              xLabel: format(parseISO(point.date), 'HH:mm:ss.SSS'),
              xOrder: new Date(point.date).getTime(),
              rawDate: point.date
            };
          }
          timeMap[timeKey][`driver_${driverNumber}`] = point[metric];
        });
      });
      return Object.values(timeMap).sort((a, b) => (a.xOrder as number) - (b.xOrder as number));
    }

    const selectedKeys = new Set(selectedLapSeries);
    const selectedOptions = lapSeriesOptions.filter((option) => selectedKeys.has(option.key));
    const seriesSamples: Record<string, Array<{ position: number; value: number }>> = {};

    selectedOptions.forEach((option) => {
      const lapData = lapCache[selectedSessionKey]?.[option.driverNumber]?.find((lap) => lap.lap_number === option.lapNumber);
      if (!lapData || !lapData.date_start || !lapData.lap_duration) return;
      const startTime = new Date(lapData.date_start).getTime();
      const endTime = startTime + lapData.lap_duration * 1000;
      const lapPoints = (telemetryCache[selectedSessionKey]?.[option.driverNumber] || [])
        .filter((point) => {
          const ts = new Date(point.date).getTime();
          return ts >= startTime && ts <= endTime;
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      if (lapPoints.length < 2) return;

      const cumulativeDistance: number[] = [0];
      for (let i = 1; i < lapPoints.length; i += 1) {
        const prev = lapPoints[i - 1];
        const current = lapPoints[i];
        const prevTs = new Date(prev.date).getTime();
        const currentTs = new Date(current.date).getTime();
        const dtSeconds = Math.max(0, (currentTs - prevTs) / 1000);
        const speedMetersPerSecond = Math.max(0, ((prev.speed ?? 0) + (current.speed ?? 0)) / 2 / 3.6);
        cumulativeDistance.push(cumulativeDistance[i - 1] + speedMetersPerSecond * dtSeconds);
      }
      const totalDistance = cumulativeDistance[cumulativeDistance.length - 1];
      const seriesKey = `series_${option.driverNumber}_${option.lapNumber}`;
      const samples: Array<{ position: number; value: number }> = [];

      lapPoints.forEach((point, index) => {
        const normalizedPosition = totalDistance > 0
          ? (cumulativeDistance[index] / totalDistance) * 100
          : (index / (lapPoints.length - 1)) * 100;
        const metricValue = point[metric];
        if (typeof metricValue !== 'number' || Number.isNaN(metricValue)) return;
        samples.push({ position: normalizedPosition, value: metricValue });
      });
      seriesSamples[seriesKey] = samples.sort((a, b) => a.position - b.position);
    });

    const interpolateSeriesAt = (samples: Array<{ position: number; value: number }>, targetPosition: number) => {
      if (samples.length === 0) return null;
      if (targetPosition <= samples[0].position) return samples[0].value;
      if (targetPosition >= samples[samples.length - 1].position) return samples[samples.length - 1].value;
      let left = 0;
      let right = samples.length - 1;
      while (left <= right) {
        const mid = (left + right) >> 1;
        if (samples[mid].position < targetPosition) left = mid + 1;
        else right = mid - 1;
      }
      const rightIndex = Math.min(left, samples.length - 1);
      const leftIndex = Math.max(0, rightIndex - 1);
      const leftSample = samples[leftIndex];
      const rightSample = samples[rightIndex];
      if (rightSample.position === leftSample.position) return rightSample.value;
      const ratio = (targetPosition - leftSample.position) / (rightSample.position - leftSample.position);
      return leftSample.value + (rightSample.value - leftSample.value) * ratio;
    };

    const bucketCount = Math.floor(100 / POSITION_BUCKET_STEP);
    const rows = Array.from({ length: bucketCount + 1 }, (_, index) => {
      const position = index * POSITION_BUCKET_STEP;
      const row: Record<string, string | number> = {
        xLabel: `${position.toFixed(1)}%`,
        xOrder: position
      };
      Object.entries(seriesSamples).forEach(([seriesKey, samples]) => {
        if (shouldInterpolateMetric) {
          const value = interpolateSeriesAt(samples, position);
          if (value !== null) row[seriesKey] = value;
          return;
        }
        const bucketStart = Math.max(0, position - POSITION_BUCKET_STEP / 2);
        const bucketEnd = Math.min(100, position + POSITION_BUCKET_STEP / 2);
        const bucketValues = samples
          .filter((sample) => sample.position >= bucketStart && sample.position < bucketEnd)
          .map((sample) => sample.value);
        if (bucketValues.length > 0) {
          row[seriesKey] = bucketValues.reduce((sum, value) => sum + value, 0) / bucketValues.length;
        }
      });
      return row;
    });

    return rows.filter((row) => Object.keys(row).some((key) => key.startsWith('series_')));
  }, [selectedSessionKey, selectedDriverNumbers, telemetryCache, metric, lapCache, viewMode, selectedLapSeries, lapSeriesOptions, shouldInterpolateMetric]);

  const progressState = useMemo(() => {
    if (!selectedSessionKey || selectedDriverNumbers.length === 0) {
      return { isLoading: false, progress: 0, loadedPoints: 0 };
    }
    const perDriver = selectedDriverNumbers.map((driverNumber) => {
      const loadState = telemetryLoadState[selectedSessionKey]?.[driverNumber];
      const cacheCount = telemetryCache[selectedSessionKey]?.[driverNumber]?.length || 0;
      const progress = loadState ? loadState.progress : cacheCount > 0 ? 100 : 0;
      const loadedPoints = Math.max(loadState?.loadedPoints || 0, cacheCount);
      return {
        isLoading: Boolean(loadState?.isLoading),
        progress,
        loadedPoints
      };
    });
    const isLoading = perDriver.some((item) => item.isLoading);
    const progress = perDriver.reduce((sum, item) => sum + item.progress, 0) / perDriver.length;
    const loadedPoints = perDriver.reduce((sum, item) => sum + item.loadedPoints, 0);
    return { isLoading, progress, loadedPoints };
  }, [selectedSessionKey, selectedDriverNumbers, telemetryLoadState, telemetryCache]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap justify-between items-start gap-3 mb-6">
        <h3 className="text-white font-mono font-bold">
          {t('telemetry.chart.title', 'Live Telemetry Trace')}
        </h3>
        <div className="flex items-start gap-3 flex-wrap ml-auto">
          <select
            className="bg-background border border-white/10 text-white text-sm rounded-md px-3 py-1 font-mono outline-none focus:border-primary"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as 'latest' | 'lap_compare')}
          >
            <option value="latest">{t('telemetry.chart.view_latest', 'Latest')}</option>
            <option value="lap_compare">{t('telemetry.chart.view_lap_compare', 'Lap Compare')}</option>
          </select>
          {viewMode === 'lap_compare' && (
            <div className="bg-background border border-white/10 rounded-md w-[220px] md:w-[240px]">
              <div className="px-3 py-1 border-b border-white/10 text-[11px] font-mono text-text-secondary">
                {t('telemetry.chart.lap_picker_hint', 'Select one or more laps')} ({selectedLapSeries.length})
              </div>
              <div className="max-h-[120px] overflow-y-auto custom-scrollbar">
                {lapSeriesOptions.map((option) => {
                  const selected = selectedLapSeries.includes(option.key);
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setSelectedLapSeries((prev) =>
                          prev.includes(option.key)
                            ? prev.filter((key) => key !== option.key)
                            : [...prev, option.key]
                        );
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm font-mono border-b border-white/5 last:border-b-0 transition-colors ${
                        selected ? 'bg-primary/15 text-primary' : 'text-white hover:bg-white/5'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <select
            className="bg-background border border-white/10 text-white text-sm rounded-md px-3 py-1 font-mono outline-none focus:border-primary"
            value={metric}
            onChange={(e) => setMetric(e.target.value as 'speed' | 'rpm' | 'throttle' | 'brake' | 'n_gear')}
          >
            <option value="speed">{t('telemetry.metrics.speed', 'Speed (km/h)')}</option>
            <option value="rpm">{t('telemetry.metrics.rpm', 'RPM')}</option>
            <option value="throttle">{t('telemetry.metrics.throttle', 'Throttle (%)')}</option>
            <option value="brake">{t('telemetry.metrics.brake', 'Brake (%)')}</option>
            <option value="n_gear">{t('telemetry.metrics.gear', 'Gear')}</option>
          </select>
        </div>
      </div>

      {progressState.isLoading && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs font-mono text-text-secondary mb-2">
            <span>{t('telemetry.chart.loading', 'Fetching telemetry...')}</span>
            <span>{progressState.progress.toFixed(0)}%</span>
          </div>
          <div className="h-2 w-full rounded bg-white/10 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progressState.progress}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] font-mono text-text-secondary">
            {t('telemetry.chart.loading_points', 'Loaded points')}: {progressState.loadedPoints}
          </div>
        </div>
      )}

      {chartData.length === 0 ? (
        <div className="flex-1 flex justify-center items-center text-text-secondary font-mono">
          {t('telemetry.chart.no_data', 'Waiting for telemetry data...')}
        </div>
      ) : (
        <div className="w-full h-[420px] min-h-[420px] min-w-0">
          <ResponsiveContainer width="100%" height={420} minWidth={0}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
              <XAxis 
                dataKey="xLabel" 
                stroke="rgba(255,255,255,0.5)" 
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                tickFormatter={(val) => {
                  if (typeof val !== 'string') return '';
                  return viewMode === 'latest' ? val.split('.')[0] : val;
                }}
                minTickGap={50}
              />
              <YAxis 
                stroke="rgba(255,255,255,0.5)" 
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                domain={metric === 'n_gear' ? [0, 8] : metric === 'throttle' || metric === 'brake' ? [0, 100] : ['auto', 'auto']}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1E1E1E', borderColor: 'rgba(255,255,255,0.1)' }}
                itemStyle={{ fontFamily: 'monospace' }}
                labelStyle={{ color: '#888', fontFamily: 'monospace', marginBottom: '5px' }}
                labelFormatter={(value: string | number) => viewMode === 'latest' ? `Time: ${value}` : `Track Position: ${value}`}
              />
              <Legend 
                wrapperStyle={{ fontFamily: 'monospace', fontSize: '12px' }}
                formatter={(value) => {
                  if (value.startsWith('driver_')) {
                    const driverNum = parseInt(value.replace('driver_', ''));
                    return getDriverName(driverNum);
                  }
                  if (value.startsWith('series_')) {
                    const [, driverNumRaw, lapNumRaw] = value.split('_');
                    const driverNum = Number(driverNumRaw);
                    const lapNum = Number(lapNumRaw);
                    return `${getDriverName(driverNum)} · Lap ${lapNum}`;
                  }
                  return value;
                }}
              />
              {viewMode === 'latest' ? (
                selectedDriverNumbers.map(driverNum => (
                  <Line
                    key={driverNum}
                    type={shouldInterpolateMetric ? 'monotone' : 'linear'}
                    dataKey={`driver_${driverNum}`}
                    stroke={getDriverColor(driverNum)}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={!liveMode}
                  />
                ))
              ) : (
                selectedLapSeries.map((seriesKey, index) => {
                  const [driverNumRaw, lapNumRaw] = seriesKey.split('_');
                  const driverNum = Number(driverNumRaw);
                  const lapNum = Number(lapNumRaw);
                  const baseColor = getDriverColor(driverNum);
                  const sameTeamBefore = selectedLapSeries.slice(0, index).reduce((count, previousSeriesKey) => {
                    const [previousDriverNumRaw] = previousSeriesKey.split('_');
                    const previousDriverNum = Number(previousDriverNumRaw);
                    return getDriverColor(previousDriverNum) === baseColor ? count + 1 : count;
                  }, 0);
                  const stroke = darkenHexColor(baseColor, 1 - sameTeamBefore * 0.18);
                  return (
                    <Line
                      key={seriesKey}
                      type={shouldInterpolateMetric ? 'monotoneX' : 'linear'}
                      dataKey={`series_${driverNum}_${lapNum}`}
                      stroke={stroke}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={shouldInterpolateMetric}
                      isAnimationActive={!liveMode}
                    />
                  );
                })
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default TelemetryChart;
