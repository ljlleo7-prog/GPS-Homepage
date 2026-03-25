import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTelemetryStore } from '../../store/telemetryStore';

interface DriverAnalysisProps {
  liveMode: boolean;
}

const DriverAnalysis = ({ liveMode }: DriverAnalysisProps) => {
  const { t } = useTranslation();
  const { 
    selectedSessionKey, 
    selectedDriverNumbers, 
    telemetryCache,
    lapCache,
    drivers,
    fetchTelemetry,
    fetchLaps
  } = useTelemetryStore();

  useEffect(() => {
    if (!selectedSessionKey || selectedDriverNumbers.length === 0) return;

    selectedDriverNumbers.forEach(driverNum => {
      if (!telemetryCache[selectedSessionKey]?.[driverNum]) {
        fetchTelemetry(selectedSessionKey, driverNum, liveMode);
      }
      if (!lapCache[selectedSessionKey]?.[driverNum]) {
        fetchLaps(selectedSessionKey, driverNum);
      }
    });
  }, [selectedSessionKey, selectedDriverNumbers, liveMode, fetchTelemetry, fetchLaps, telemetryCache, lapCache]);

  const formatLapTime = (seconds: number | null) => {
    if (seconds === null || !Number.isFinite(seconds)) return '---';
    const totalMs = Math.round(seconds * 1000);
    const minutes = Math.floor(totalMs / 60000);
    const remainderMs = totalMs % 60000;
    const secs = Math.floor(remainderMs / 1000);
    const millis = remainderMs % 1000;
    return `${minutes}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
  };

  const formatDelta = (value: number | null, unit = 's') => {
    if (value === null || !Number.isFinite(value)) return '---';
    if (Math.abs(value) < 0.0005) return `+0.000 ${unit}`;
    const sign = value > 0 ? '+' : '-';
    return `${sign}${Math.abs(value).toFixed(3)} ${unit}`;
  };

  const stats = useMemo(() => {
    if (!selectedSessionKey) return [];

    const rows = selectedDriverNumbers
      .map((driverNum) => {
        const driver = drivers.find((d) => d.driver_number === driverNum);
        if (!driver) return null;

        const telemetry = (telemetryCache[selectedSessionKey]?.[driverNum] || [])
          .slice()
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const laps = lapCache[selectedSessionKey]?.[driverNum] || [];
        const validLaps = laps.filter((lap) => Number.isFinite(lap.lap_duration) && lap.lap_duration > 0 && !lap.is_pit_out_lap);

        const telemetryCount = telemetry.length;
        const latestPoint = telemetryCount > 0 ? telemetry[telemetryCount - 1] : null;

        let speedSum = 0;
        let rpmSum = 0;
        let throttleSum = 0;
        let brakeSum = 0;
        let topSpeed = 0;
        let fullThrottleCount = 0;
        let heavyBrakeCount = 0;
        let coastCount = 0;
        let drsOnCount = 0;
        let gearShifts = 0;

        for (let i = 0; i < telemetryCount; i += 1) {
          const p = telemetry[i];
          const speed = p.speed ?? 0;
          const rpm = p.rpm ?? 0;
          const throttle = p.throttle ?? 0;
          const brake = p.brake ?? 0;
          speedSum += speed;
          rpmSum += rpm;
          throttleSum += throttle;
          brakeSum += brake;
          if (speed > topSpeed) topSpeed = speed;
          if (throttle >= 95) fullThrottleCount += 1;
          if (brake >= 20) heavyBrakeCount += 1;
          if (throttle <= 5 && brake <= 5) coastCount += 1;
          if ((p.drs ?? 0) > 0) drsOnCount += 1;
          if (i > 0 && telemetry[i - 1].n_gear !== p.n_gear) gearShifts += 1;
        }

        const lapDurations = validLaps.map((lap) => lap.lap_duration);
        const bestLap = lapDurations.length > 0 ? Math.min(...lapDurations) : null;
        const avgLap = lapDurations.length > 0 ? lapDurations.reduce((a, b) => a + b, 0) / lapDurations.length : null;
        const lapVariance = avgLap !== null && lapDurations.length > 0
          ? lapDurations.reduce((sum, value) => sum + (value - avgLap) ** 2, 0) / lapDurations.length
          : null;
        const lapStdDev = lapVariance !== null ? Math.sqrt(lapVariance) : null;

        const bestS1 = validLaps.length > 0 ? Math.min(...validLaps.map((lap) => lap.sector_1)) : null;
        const bestS2 = validLaps.length > 0 ? Math.min(...validLaps.map((lap) => lap.sector_2)) : null;
        const bestS3 = validLaps.length > 0 ? Math.min(...validLaps.map((lap) => lap.sector_3)) : null;
        const theoreticalBest = bestS1 !== null && bestS2 !== null && bestS3 !== null ? bestS1 + bestS2 + bestS3 : null;

        return {
          driver,
          latestPoint,
          telemetryCount,
          completedLaps: validLaps.length,
          avgSpeed: telemetryCount > 0 ? speedSum / telemetryCount : null,
          topSpeed: telemetryCount > 0 ? topSpeed : null,
          avgRpm: telemetryCount > 0 ? rpmSum / telemetryCount : null,
          avgThrottle: telemetryCount > 0 ? throttleSum / telemetryCount : null,
          avgBrake: telemetryCount > 0 ? brakeSum / telemetryCount : null,
          fullThrottlePct: telemetryCount > 0 ? (fullThrottleCount / telemetryCount) * 100 : null,
          heavyBrakePct: telemetryCount > 0 ? (heavyBrakeCount / telemetryCount) * 100 : null,
          coastPct: telemetryCount > 0 ? (coastCount / telemetryCount) * 100 : null,
          drsPct: telemetryCount > 0 ? (drsOnCount / telemetryCount) * 100 : null,
          gearShifts,
          bestLap,
          avgLap,
          lapStdDev,
          bestS1,
          bestS2,
          bestS3,
          theoreticalBest
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const referenceBestLap = rows
      .map((r) => r.bestLap)
      .filter((value): value is number => value !== null)
      .reduce<number | null>((best, value) => (best === null || value < best ? value : best), null);

    const referenceTopSpeed = rows
      .map((r) => r.topSpeed)
      .filter((value): value is number => value !== null)
      .reduce<number | null>((best, value) => (best === null || value > best ? value : best), null);

    return rows
      .map((row) => ({
        ...row,
        lapDelta: row.bestLap !== null && referenceBestLap !== null ? row.bestLap - referenceBestLap : null,
        topSpeedDelta: row.topSpeed !== null && referenceTopSpeed !== null ? row.topSpeed - referenceTopSpeed : null
      }))
      .sort((a, b) => {
        if (a.bestLap !== null && b.bestLap !== null) return a.bestLap - b.bestLap;
        if (a.bestLap !== null) return -1;
        if (b.bestLap !== null) return 1;
        const aSpeed = a.avgSpeed ?? -1;
        const bSpeed = b.avgSpeed ?? -1;
        return bSpeed - aSpeed;
      });
  }, [selectedSessionKey, selectedDriverNumbers, telemetryCache, lapCache, drivers]);

  return (
    <div className="flex flex-col h-full">
      <h3 className="text-white font-mono font-bold mb-6">
        {t('telemetry.drivers.title', 'Driver Comparison Overview')}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {stats.map((item) => {
          const { driver, latestPoint } = item;
          return (
            <div key={driver.driver_number} className="bg-background rounded-lg border border-white/5 overflow-hidden">
              <div 
                className="px-4 py-3 border-b border-white/5 flex items-center justify-between"
                style={{ backgroundColor: `${`#${driver.team_colour}`}20`, borderTop: `3px solid #${driver.team_colour}` }}
              >
                <div className="flex items-center gap-3">
                  {driver.headshot_url && (
                    <img src={driver.headshot_url} alt={driver.name_acronym} className="w-10 h-10 object-contain rounded-full bg-white/10" />
                  )}
                  <div>
                    <div className="font-mono font-bold text-white text-lg leading-tight">
                      {driver.full_name}
                    </div>
                    <div className="text-xs text-text-secondary font-mono">
                      {driver.team_name}
                    </div>
                  </div>
                </div>
                <div className="text-2xl font-mono font-bold text-white/50">
                  {driver.driver_number}
                </div>
              </div>
              
              <div className="p-4 grid grid-cols-2 gap-3">
                <div className="bg-surface p-3 rounded border border-white/5">
                  <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.current_speed', 'Current Speed')}</div>
                  <div className="text-white font-mono font-bold text-lg">
                    {latestPoint ? `${latestPoint.speed} km/h` : '---'}
                  </div>
                </div>
                <div className="bg-surface p-3 rounded border border-white/5">
                  <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.current_gear', 'Current Gear')}</div>
                  <div className="text-white font-mono font-bold text-lg">
                    {latestPoint ? latestPoint.n_gear : '-'}
                  </div>
                </div>
                <div className="bg-surface p-3 rounded border border-white/5">
                  <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.best_lap', 'Best Lap')}</div>
                  <div className="text-white font-mono font-bold text-lg">
                    {formatLapTime(item.bestLap)}
                  </div>
                  <div className={`text-[11px] font-mono mt-1 ${item.lapDelta === null ? 'text-text-secondary' : item.lapDelta <= 0 ? 'text-green-400' : 'text-amber-300'}`}>
                    {t('telemetry.drivers.delta_to_leader', 'Delta')}: {formatDelta(item.lapDelta)}
                  </div>
                </div>
                <div className="bg-surface p-3 rounded border border-white/5">
                  <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.top_speed', 'Top Speed')}</div>
                  <div className="text-white font-mono font-bold text-lg">
                    {item.topSpeed !== null ? `${Math.round(item.topSpeed)} km/h` : '---'}
                  </div>
                  <div className={`text-[11px] font-mono mt-1 ${item.topSpeedDelta === null ? 'text-text-secondary' : item.topSpeedDelta >= 0 ? 'text-green-400' : 'text-amber-300'}`}>
                    {t('telemetry.drivers.delta_to_fastest_vmax', 'Δ Vmax')}: {item.topSpeedDelta === null ? '---' : `${item.topSpeedDelta >= 0 ? '+' : ''}${item.topSpeedDelta.toFixed(1)} km/h`}
                  </div>
                </div>
              </div>
              <div className="px-4 pb-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface p-3 rounded border border-white/5">
                    <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.avg_speed', 'Avg Speed')}</div>
                    <div className="text-white font-mono font-bold text-base">
                      {item.avgSpeed !== null ? `${item.avgSpeed.toFixed(1)} km/h` : '---'}
                    </div>
                  </div>
                  <div className="bg-surface p-3 rounded border border-white/5">
                    <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.avg_rpm', 'Avg RPM')}</div>
                    <div className="text-white font-mono font-bold text-base">
                      {item.avgRpm !== null ? Math.round(item.avgRpm).toLocaleString() : '---'}
                    </div>
                  </div>
                  <div className="bg-surface p-3 rounded border border-white/5">
                    <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.completed_laps', 'Completed Laps')}</div>
                    <div className="text-white font-mono font-bold text-base">{item.completedLaps}</div>
                  </div>
                  <div className="bg-surface p-3 rounded border border-white/5">
                    <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.lap_consistency', 'Lap Consistency')}</div>
                    <div className="text-white font-mono font-bold text-base">
                      {item.lapStdDev !== null ? `±${item.lapStdDev.toFixed(3)} s` : '---'}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface p-3 rounded border border-white/5">
                    <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.avg_lap', 'Avg Lap')}</div>
                    <div className="text-white font-mono font-bold text-base">{formatLapTime(item.avgLap)}</div>
                  </div>
                  <div className="bg-surface p-3 rounded border border-white/5">
                    <div className="text-text-secondary text-xs font-mono mb-1">{t('telemetry.drivers.theoretical_best', 'Theoretical Best')}</div>
                    <div className="text-white font-mono font-bold text-base">{formatLapTime(item.theoreticalBest)}</div>
                  </div>
                </div>
                <div className="bg-surface p-3 rounded border border-white/5 space-y-2">
                  <div className="text-text-secondary text-xs font-mono">{t('telemetry.drivers.control_profile', 'Control Profile')}</div>
                  <div className="text-[11px] font-mono text-white flex items-center justify-between">
                    <span>{t('telemetry.drivers.avg_throttle', 'Avg Throttle')}</span>
                    <span>{item.avgThrottle !== null ? `${item.avgThrottle.toFixed(1)}%` : '---'}</span>
                  </div>
                  <div className="text-[11px] font-mono text-white flex items-center justify-between">
                    <span>{t('telemetry.drivers.avg_brake', 'Avg Brake')}</span>
                    <span>{item.avgBrake !== null ? `${item.avgBrake.toFixed(1)}%` : '---'}</span>
                  </div>
                  <div className="text-[11px] font-mono text-white flex items-center justify-between">
                    <span>{t('telemetry.drivers.full_throttle', 'Full Throttle')}</span>
                    <span>{item.fullThrottlePct !== null ? `${item.fullThrottlePct.toFixed(1)}%` : '---'}</span>
                  </div>
                  <div className="text-[11px] font-mono text-white flex items-center justify-between">
                    <span>{t('telemetry.drivers.heavy_brake', 'Heavy Brake')}</span>
                    <span>{item.heavyBrakePct !== null ? `${item.heavyBrakePct.toFixed(1)}%` : '---'}</span>
                  </div>
                  <div className="text-[11px] font-mono text-white flex items-center justify-between">
                    <span>{t('telemetry.drivers.coast_time', 'Coast Time')}</span>
                    <span>{item.coastPct !== null ? `${item.coastPct.toFixed(1)}%` : '---'}</span>
                  </div>
                  <div className="text-[11px] font-mono text-white flex items-center justify-between">
                    <span>{t('telemetry.drivers.drs_usage', 'DRS Active')}</span>
                    <span>{item.drsPct !== null ? `${item.drsPct.toFixed(1)}%` : '---'}</span>
                  </div>
                  <div className="text-[11px] font-mono text-white flex items-center justify-between">
                    <span>{t('telemetry.drivers.gear_shifts', 'Gear Shifts')}</span>
                    <span>{item.gearShifts}</span>
                  </div>
                </div>
                <div className="bg-surface p-3 rounded border border-white/5">
                  <div className="text-text-secondary text-xs font-mono mb-2">{t('telemetry.drivers.best_sectors', 'Best Sectors')}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-[10px] font-mono text-text-secondary">S1</div>
                      <div className="text-[13px] font-mono text-white font-bold">{item.bestS1 !== null ? item.bestS1.toFixed(3) : '---'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-text-secondary">S2</div>
                      <div className="text-[13px] font-mono text-white font-bold">{item.bestS2 !== null ? item.bestS2.toFixed(3) : '---'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-text-secondary">S3</div>
                      <div className="text-[13px] font-mono text-white font-bold">{item.bestS3 !== null ? item.bestS3.toFixed(3) : '---'}</div>
                    </div>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-text-secondary">
                  {t('telemetry.drivers.sample_size', 'Telemetry Samples')}: {item.telemetryCount}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DriverAnalysis;
