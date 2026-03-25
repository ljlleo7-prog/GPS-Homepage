import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useTelemetryStore, type TelemetryData, type InterpolationSettings } from '../../store/telemetryStore';

interface RealTimeHudProps {
  liveMode: boolean;
}

interface SamplePoint {
  t: number;
  speed: number;
  rpm: number;
  throttle: number;
  brake: number;
  n_gear: number;
  drs: number | null;
}

interface HudAudioNodes {
  context: AudioContext;
  masterGain: GainNode;
  engineFilter: BiquadFilterNode;
  rotorFilter: BiquadFilterNode;
  engineOsc: OscillatorNode;
  engineSubOsc: OscillatorNode;
  rotorOsc: OscillatorNode;
  textureOsc: OscillatorNode;
  ersOsc: OscillatorNode;
  engineGain: GainNode;
  engineSubGain: GainNode;
  rotorGain: GainNode;
  textureGain: GainNode;
  ersGain: GainNode;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const hudTechFont = '"Orbitron", "Rajdhani", "Eurostile", "Bank Gothic", "Microgramma", "Fira Code", "JetBrains Mono", "Segoe UI", sans-serif';
const hudTechMonoFont = '"Orbitron", "Rajdhani", "Eurostile", "Bank Gothic", "Microgramma", "Fira Code", "JetBrains Mono", monospace';

const interpolateCatmull = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
};

const interpolateRpmByShift = (
  points: SamplePoint[],
  i1: number,
  i2: number,
  p1: SamplePoint,
  p2: SamplePoint,
  t: number
) => {
  const gearDelta = p2.n_gear - p1.n_gear;
  if (gearDelta === 0) {
    let leftIndex = i1;
    for (let index = i1 - 1; index >= 0; index -= 1) {
      if (points[index].n_gear !== p1.n_gear) break;
      leftIndex = index;
      break;
    }
    let rightIndex = i2;
    for (let index = i2 + 1; index < points.length; index += 1) {
      if (points[index].n_gear !== p2.n_gear) break;
      rightIndex = index;
      break;
    }
    const leftControl = points[leftIndex];
    const rightControl = points[rightIndex];
    return clamp(interpolateCatmull(leftControl.rpm, p1.rpm, p2.rpm, rightControl.rpm, t), 0, 20000);
  }

  const segmentDuration = Math.max(1, p2.t - p1.t);
  let leftSlope = 0;
  if (i1 > 0 && points[i1 - 1].n_gear === p1.n_gear) {
    const previous = points[i1 - 1];
    leftSlope = (p1.rpm - previous.rpm) / Math.max(1, p1.t - previous.t);
  }
  let rightSlope = 0;
  if (i2 + 1 < points.length && points[i2 + 1].n_gear === p2.n_gear) {
    const next = points[i2 + 1];
    rightSlope = (next.rpm - p2.rpm) / Math.max(1, next.t - p2.t);
  }
  if (t < 0.5) {
    const elapsed = t * segmentDuration;
    return clamp(p1.rpm + leftSlope * elapsed, 0, 20000);
  }
  const elapsedFromRight = (1 - t) * segmentDuration;
  return clamp(p2.rpm - rightSlope * elapsedFromRight, 0, 20000);
};

const describeArc = (cx: number, cy: number, radius: number, startAngle: number, endAngle: number) => {
  const start = {
    x: cx + radius * Math.cos((Math.PI / 180) * startAngle),
    y: cy + radius * Math.sin((Math.PI / 180) * startAngle)
  };
  const end = {
    x: cx + radius * Math.cos((Math.PI / 180) * endAngle),
    y: cy + radius * Math.sin((Math.PI / 180) * endAngle)
  };
  const sweep = endAngle - startAngle;
  const largeArcFlag = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep >= 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
};

const normalizeTelemetry = (data: TelemetryData[]): SamplePoint[] => {
  return data
    .map((point) => ({
      t: new Date(point.date).getTime(),
      speed: point.speed ?? 0,
      rpm: point.rpm ?? 0,
      throttle: point.throttle ?? 0,
      brake: point.brake ?? 0,
      n_gear: point.n_gear ?? 0,
      drs: point.drs
    }))
    .sort((a, b) => a.t - b.t);
};

const interpolateFrame = (
  points: SamplePoint[],
  targetTs: number,
  interpolation: InterpolationSettings
): SamplePoint | null => {
  if (points.length === 0) return null;
  if (targetTs <= points[0].t) return points[0];
  if (targetTs >= points[points.length - 1].t) return points[points.length - 1];

  let left = 0;
  let right = points.length - 1;
  while (left <= right) {
    const mid = (left + right) >> 1;
    if (points[mid].t < targetTs) left = mid + 1;
    else right = mid - 1;
  }

  const i2 = clamp(left, 1, points.length - 1);
  const i1 = i2 - 1;
  const i0 = Math.max(0, i1 - 1);
  const i3 = Math.min(points.length - 1, i2 + 1);
  const p0 = points[i0];
  const p1 = points[i1];
  const p2 = points[i2];
  const p3 = points[i3];
  const segmentDuration = Math.max(1, p2.t - p1.t);
  const t = clamp((targetTs - p1.t) / segmentDuration, 0, 1);
  const shouldInterpolateMetric = (metric: 'speed' | 'rpm' | 'throttle' | 'brake' | 'n_gear') =>
    interpolation.enabled && interpolation.metrics[metric];
  const rawSpeed = t < 0.5 ? p1.speed : p2.speed;
  const rawRpm = t < 0.5 ? p1.rpm : p2.rpm;
  const rawThrottle = t < 0.5 ? p1.throttle : p2.throttle;
  const rawBrake = t < 0.5 ? p1.brake : p2.brake;
  const rawGear = t < 0.5 ? p1.n_gear : p2.n_gear;

  return {
    t: targetTs,
    speed: shouldInterpolateMetric('speed')
      ? clamp(interpolateCatmull(p0.speed, p1.speed, p2.speed, p3.speed, t), 0, 420)
      : clamp(rawSpeed, 0, 420),
    rpm: shouldInterpolateMetric('rpm') ? interpolateRpmByShift(points, i1, i2, p1, p2, t) : clamp(rawRpm, 0, 20000),
    throttle: shouldInterpolateMetric('throttle')
      ? clamp(interpolateCatmull(p0.throttle, p1.throttle, p2.throttle, p3.throttle, t), 0, 100)
      : clamp(rawThrottle, 0, 100),
    brake: shouldInterpolateMetric('brake')
      ? clamp(interpolateCatmull(p0.brake, p1.brake, p2.brake, p3.brake, t), 0, 100)
      : clamp(rawBrake, 0, 100),
    n_gear: shouldInterpolateMetric('n_gear')
      ? clamp(Math.round(interpolateCatmull(p0.n_gear, p1.n_gear, p2.n_gear, p3.n_gear, t)), 0, 8)
      : clamp(Math.round(rawGear), 0, 8),
    drs: t < 0.5 ? p1.drs : p2.drs
  };
};

const RealTimeHud = ({ liveMode }: RealTimeHudProps) => {
  const { t } = useTranslation();
  const {
    selectedSessionKey,
    selectedDriverNumbers,
    telemetryCache,
    lapCache,
    fetchTelemetry,
    fetchLaps,
    drivers,
    interpolation
  } = useTelemetryStore();

  const [hudMode, setHudMode] = useState<'latest' | 'lap_compare'>('latest');
  const [hudDriver, setHudDriver] = useState<number | null>(null);
  const [selectedLapSlots, setSelectedLapSlots] = useState<string[]>([]);
  const [mutedLapSlots, setMutedLapSlots] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [frame, setFrame] = useState<SamplePoint | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const rafRef = useRef<number | null>(null);
  const anchorRef = useRef<{ wallTime: number; elapsed: number }>({ wallTime: 0, elapsed: 0 });
  const audioRef = useRef<HudAudioNodes | null>(null);
  const progressTrackRef = useRef<HTMLDivElement | null>(null);
  const isSeekingRef = useRef(false);

  useEffect(() => {
    if (selectedDriverNumbers.length === 0) {
      setHudDriver(null);
      return;
    }
    if (!hudDriver || !selectedDriverNumbers.includes(hudDriver)) {
      setHudDriver(selectedDriverNumbers[0]);
    }
  }, [selectedDriverNumbers, hudDriver]);

  useEffect(() => {
    if (!selectedSessionKey || selectedDriverNumbers.length === 0) return;
    selectedDriverNumbers.forEach((driverNumber) => {
      fetchLaps(selectedSessionKey, driverNumber);
    });
  }, [selectedSessionKey, selectedDriverNumbers, fetchLaps]);

  useEffect(() => {
    if (!selectedSessionKey) return;
    if (hudMode === 'latest') {
      if (!hudDriver) return;
      fetchTelemetry(selectedSessionKey, hudDriver, liveMode);
      if (!liveMode) return;
      const interval = window.setInterval(() => {
        fetchTelemetry(selectedSessionKey, hudDriver, true);
      }, 3000);
      return () => window.clearInterval(interval);
    }
    selectedDriverNumbers.forEach((driverNumber) => {
      fetchTelemetry(selectedSessionKey, driverNumber, false);
    });
  }, [selectedSessionKey, hudMode, hudDriver, liveMode, selectedDriverNumbers, fetchTelemetry]);

  const lapSeriesOptions = useMemo(() => {
    if (!selectedSessionKey || selectedDriverNumbers.length === 0) return [];
    return selectedDriverNumbers
      .flatMap((driverNumber) => {
        const laps = lapCache[selectedSessionKey]?.[driverNumber] || [];
        const driver = drivers.find((item) => item.driver_number === driverNumber);
        const driverName = driver ? driver.name_acronym : `Driver ${driverNumber}`;
        return laps
          .filter((lap) => Boolean(lap.date_start) && Boolean(lap.lap_duration))
          .map((lap) => ({
            key: `${driverNumber}_${lap.lap_number}`,
            driverNumber,
            lapNumber: lap.lap_number,
            label: `${driverName} · Lap ${lap.lap_number}`
          }));
      })
      .sort((a, b) => {
        if (a.driverNumber !== b.driverNumber) return a.driverNumber - b.driverNumber;
        return a.lapNumber - b.lapNumber;
      });
  }, [selectedSessionKey, selectedDriverNumbers, lapCache, drivers]);

  useEffect(() => {
    const optionSet = new Set(lapSeriesOptions.map((option) => option.key));
    setSelectedLapSlots((prev) => {
      const filtered = prev.filter((key) => optionSet.has(key)).slice(0, 4);
      if (filtered.length > 0 || lapSeriesOptions.length === 0) return filtered;
      return lapSeriesOptions.slice(0, 2).map((item) => item.key);
    });
  }, [lapSeriesOptions]);

  useEffect(() => {
    const selectedSet = new Set(selectedLapSlots);
    setMutedLapSlots((prev) => prev.filter((key) => selectedSet.has(key)));
  }, [selectedLapSlots]);

  const points = useMemo(() => {
    if (!selectedSessionKey || !hudDriver) return [];
    const source = telemetryCache[selectedSessionKey]?.[hudDriver] || [];
    return normalizeTelemetry(source);
  }, [selectedSessionKey, hudDriver, telemetryCache]);

  const latestDuration = useMemo(() => {
    if (points.length < 2) return 0;
    return points[points.length - 1].t - points[0].t;
  }, [points]);

  const compareSlots = useMemo(() => {
    if (!selectedSessionKey) return [];
    return selectedLapSlots.slice(0, 4).map((slotKey) => {
      const [driverRaw, lapRaw] = slotKey.split('_');
      const driverNumber = Number(driverRaw);
      const lapNumber = Number(lapRaw);
      const lapData = lapCache[selectedSessionKey]?.[driverNumber]?.find((lap) => lap.lap_number === lapNumber);
      const telemetry = telemetryCache[selectedSessionKey]?.[driverNumber] || [];
      const normalized = normalizeTelemetry(telemetry);
      const driver = drivers.find((item) => item.driver_number === driverNumber);
      if (!lapData?.date_start || !lapData.lap_duration || normalized.length === 0) {
        return { key: slotKey, driverNumber, lapNumber, durationMs: 0, startTs: 0, points: [] as SamplePoint[], driver };
      }
      const startTs = new Date(lapData.date_start).getTime();
      const plannedDuration = Math.max(1, lapData.lap_duration > 1000 ? lapData.lap_duration : lapData.lap_duration * 1000);
      const nextLap = (lapCache[selectedSessionKey]?.[driverNumber] || [])
        .filter((lap) => lap.lap_number > lapNumber && Boolean(lap.date_start))
        .sort((a, b) => a.lap_number - b.lap_number)[0];
      const nextStartTs = nextLap?.date_start ? new Date(nextLap.date_start).getTime() : Number.NaN;
      const endTs = Number.isFinite(nextStartTs) ? Math.min(startTs + plannedDuration, nextStartTs) : startTs + plannedDuration;
      const lapPoints = normalized.filter((point) => point.t >= startTs && point.t <= endTs);
      if (lapPoints.length < 2) {
        return { key: slotKey, driverNumber, lapNumber, durationMs: Math.max(1, endTs - startTs), startTs, points: lapPoints, driver };
      }
      const actualDuration = lapPoints[lapPoints.length - 1].t - lapPoints[0].t;
      return {
        key: slotKey,
        driverNumber,
        lapNumber,
        durationMs: Math.max(1, actualDuration || (endTs - startTs)),
        startTs,
        points: lapPoints,
        driver
      };
    });
  }, [selectedSessionKey, selectedLapSlots, lapCache, telemetryCache, drivers]);

  const activeCompareSlots = useMemo(
    () => compareSlots.filter((slot) => slot.points.length > 0 && slot.durationMs > 0),
    [compareSlots]
  );

  const referenceDuration = useMemo(() => {
    if (hudMode === 'latest') return latestDuration;
    if (activeCompareSlots.length === 0) return 0;
    const total = activeCompareSlots.reduce((sum, slot) => sum + slot.durationMs, 0);
    return Math.max(1, total / activeCompareSlots.length);
  }, [hudMode, latestDuration, activeCompareSlots]);

  useEffect(() => {
    if (hudMode !== 'latest') return;
    setElapsedMs(0);
    setFrame(points.length > 0 ? points[0] : null);
    anchorRef.current = { wallTime: performance.now(), elapsed: 0 };
  }, [hudMode, points, hudDriver]);

  useEffect(() => {
    if (hudMode !== 'lap_compare') return;
    setElapsedMs(0);
    if (activeCompareSlots.length > 0) {
      setFrame(interpolateFrame(activeCompareSlots[0].points, activeCompareSlots[0].startTs, interpolation));
    } else {
      setFrame(null);
    }
    anchorRef.current = { wallTime: performance.now(), elapsed: 0 };
  }, [hudMode, activeCompareSlots, interpolation]);

  useEffect(() => {
    const hasLatestStream = hudMode === 'latest' && points.length >= 2;
    const hasCompareStream = hudMode === 'lap_compare' && activeCompareSlots.length > 0;
    if (!isPlaying || (!hasLatestStream && !hasCompareStream) || referenceDuration <= 0) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    anchorRef.current = { wallTime: performance.now(), elapsed: elapsedMs };

    const tick = () => {
      const now = performance.now();
      const advanced = (now - anchorRef.current.wallTime) * playbackSpeed;
      const nextElapsed = anchorRef.current.elapsed + advanced;
      const boundedElapsed = referenceDuration > 0 ? Math.min(nextElapsed, referenceDuration) : 0;
      if (hudMode === 'latest' && points.length > 0) {
        const targetTs = points[0].t + boundedElapsed;
        setFrame(interpolateFrame(points, targetTs, interpolation));
      }
      setElapsedMs(boundedElapsed);
      if (referenceDuration > 0 && boundedElapsed >= referenceDuration && !liveMode) {
        setIsPlaying(false);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isPlaying, playbackSpeed, hudMode, points, activeCompareSlots, referenceDuration, elapsedMs, liveMode, interpolation]);

  useEffect(() => {
    return () => {
      const nodes = audioRef.current;
      if (nodes) {
        nodes.context.close();
        audioRef.current = null;
      }
    };
  }, []);

  const compareFrames = useMemo(() => {
    if (hudMode !== 'lap_compare' || activeCompareSlots.length === 0) return [];
    const ratio = referenceDuration > 0 ? clamp(elapsedMs / referenceDuration, 0, 1) : 0;
    return activeCompareSlots.map((slot) => {
      const targetTs = slot.startTs + slot.durationMs * ratio;
      return { ...slot, frame: interpolateFrame(slot.points, targetTs, interpolation) };
    });
  }, [hudMode, activeCompareSlots, elapsedMs, referenceDuration, interpolation]);

  const audioFrame = useMemo(() => {
    if (hudMode === 'latest') return frame;
    const mutedSet = new Set(mutedLapSlots);
    const unmutedFrames = compareFrames
      .filter((slot) => !mutedSet.has(slot.key))
      .map((slot) => slot.frame)
      .filter((item): item is SamplePoint => item !== null);
    if (unmutedFrames.length === 0) return null;
    const count = unmutedFrames.length;
    const sum = unmutedFrames.reduce(
      (acc, item) => ({
        speed: acc.speed + item.speed,
        rpm: acc.rpm + item.rpm,
        throttle: acc.throttle + item.throttle,
        brake: acc.brake + item.brake,
        n_gear: acc.n_gear + item.n_gear,
        drs: acc.drs || Boolean((item.drs ?? 0) > 0)
      }),
      { speed: 0, rpm: 0, throttle: 0, brake: 0, n_gear: 0, drs: false }
    );
    return {
      t: Date.now(),
      speed: sum.speed / count,
      rpm: sum.rpm / count,
      throttle: sum.throttle / count,
      brake: sum.brake / count,
      n_gear: Math.round(sum.n_gear / count),
      drs: sum.drs ? 1 : 0
    };
  }, [hudMode, frame, compareFrames, mutedLapSlots]);

  const progress = referenceDuration > 0 ? clamp((elapsedMs / referenceDuration) * 100, 0, 100) : 0;
  const driver = drivers.find((item) => item.driver_number === hudDriver);

  const seekToProgress = (nextProgress: number) => {
    if (referenceDuration <= 0) return;
    const boundedProgress = clamp(nextProgress, 0, 100);
    const nextElapsed = (boundedProgress / 100) * referenceDuration;
    setElapsedMs(nextElapsed);
    if (hudMode === 'latest' && points.length > 0) {
      const targetTs = points[0].t + nextElapsed;
      setFrame(interpolateFrame(points, targetTs, interpolation));
    }
    anchorRef.current = { wallTime: performance.now(), elapsed: nextElapsed };
  };

  const seekToClientX = (clientX: number) => {
    const track = progressTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    seekToProgress(ratio * 100);
  };

  const handleProgressPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    isSeekingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToClientX(event.clientX);
  };

  const handleProgressPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSeekingRef.current) return;
    seekToClientX(event.clientX);
  };

  const handleProgressPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSeekingRef.current) return;
    isSeekingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const initializeAudio = async () => {
    if (audioRef.current) return audioRef.current;
    const context = new AudioContext();
    const masterGain = context.createGain();
    const engineFilter = context.createBiquadFilter();
    const rotorFilter = context.createBiquadFilter();
    const engineGain = context.createGain();
    const engineSubGain = context.createGain();
    const rotorGain = context.createGain();
    const textureGain = context.createGain();
    const ersGain = context.createGain();
    const engineOsc = context.createOscillator();
    const engineSubOsc = context.createOscillator();
    const rotorOsc = context.createOscillator();
    const textureOsc = context.createOscillator();
    const ersOsc = context.createOscillator();

    engineOsc.type = 'square';
    engineSubOsc.type = 'square';
    rotorOsc.type = 'square';
    textureOsc.type = 'triangle';
    ersOsc.type = 'triangle';

    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 2200;
    engineFilter.Q.value = 0.8;
    rotorFilter.type = 'bandpass';
    rotorFilter.frequency.value = 900;
    rotorFilter.Q.value = 1.4;

    masterGain.gain.value = 0.45;
    engineGain.gain.value = 0;
    engineSubGain.gain.value = 0;
    rotorGain.gain.value = 0;
    textureGain.gain.value = 0;
    ersGain.gain.value = 0;

    engineOsc.connect(engineGain);
    engineSubOsc.connect(engineSubGain);
    rotorOsc.connect(rotorGain);
    textureOsc.connect(textureGain);
    ersOsc.connect(ersGain);
    engineGain.connect(engineFilter);
    engineSubGain.connect(engineFilter);
    rotorGain.connect(rotorFilter);
    textureGain.connect(rotorFilter);
    engineFilter.connect(masterGain);
    rotorFilter.connect(masterGain);
    ersGain.connect(masterGain);
    masterGain.connect(context.destination);

    engineOsc.start();
    engineSubOsc.start();
    rotorOsc.start();
    textureOsc.start();
    ersOsc.start();

    const nodes: HudAudioNodes = {
      context,
      masterGain,
      engineFilter,
      rotorFilter,
      engineOsc,
      engineSubOsc,
      rotorOsc,
      textureOsc,
      ersOsc,
      engineGain,
      engineSubGain,
      rotorGain,
      textureGain,
      ersGain
    };
    audioRef.current = nodes;
    return nodes;
  };

  const handleSoundToggle = async () => {
    if (soundEnabled) {
      const nodes = audioRef.current;
      if (nodes) {
        nodes.engineGain.gain.setTargetAtTime(0, nodes.context.currentTime, 0.03);
        nodes.engineSubGain.gain.setTargetAtTime(0, nodes.context.currentTime, 0.03);
        nodes.rotorGain.gain.setTargetAtTime(0, nodes.context.currentTime, 0.03);
        nodes.textureGain.gain.setTargetAtTime(0, nodes.context.currentTime, 0.03);
        nodes.ersGain.gain.setTargetAtTime(0, nodes.context.currentTime, 0.03);
        await nodes.context.suspend();
      }
      setSoundEnabled(false);
      return;
    }

    const nodes = await initializeAudio();
    if (nodes.context.state === 'suspended') {
      await nodes.context.resume();
    }
    setSoundEnabled(true);
  };

  useEffect(() => {
    const nodes = audioRef.current;
    if (!nodes || !soundEnabled) return;
    const now = nodes.context.currentTime;
    const currentRpm = audioFrame?.rpm ?? 0;
    const currentSpeed = audioFrame?.speed ?? 0;
    const currentThrottle = audioFrame?.throttle ?? 0;
    const ersDeployed = Boolean((audioFrame?.drs ?? 0) > 0);
    const active = isPlaying && audioFrame !== null;
    const engineFrequency = clamp(currentRpm / 40, 20, 2000);
    const rotorFrequency = clamp(currentRpm / 60, 20, 2000);
    const ersFrequency = clamp(currentSpeed * 4, 20, 4000);
    const subFrequency = clamp(engineFrequency * 0.5, 20, 1000);
    const textureFrequency = clamp(engineFrequency * 2.2, 60, 4500);

    nodes.engineOsc.frequency.setTargetAtTime(engineFrequency, now, 0.03);
    nodes.engineSubOsc.frequency.setTargetAtTime(subFrequency, now, 0.03);
    nodes.rotorOsc.frequency.setTargetAtTime(rotorFrequency, now, 0.03);
    nodes.textureOsc.frequency.setTargetAtTime(textureFrequency, now, 0.03);
    nodes.ersOsc.frequency.setTargetAtTime(ersFrequency, now, 0.03);
    nodes.engineFilter.frequency.setTargetAtTime(clamp(1400 + currentThrottle * 14, 1400, 3600), now, 0.04);
    nodes.rotorFilter.frequency.setTargetAtTime(clamp(600 + currentThrottle * 10, 600, 2000), now, 0.04);

    nodes.engineGain.gain.setTargetAtTime(active ? 0.15 + currentThrottle * 0.001 : 0, now, 0.03);
    nodes.engineSubGain.gain.setTargetAtTime(active ? 0.035 : 0, now, 0.03);
    nodes.rotorGain.gain.setTargetAtTime(active ? 0.2 + currentThrottle * 0.001 : 0, now, 0.03);
    nodes.textureGain.gain.setTargetAtTime(active ? 0.025 + currentThrottle * 0.0003 : 0, now, 0.03);
    nodes.ersGain.gain.setTargetAtTime(active && ersDeployed ? 0.07 : 0, now, 0.03);
  }, [soundEnabled, audioFrame, isPlaying]);

  const renderHudPanel = (
    panelId: string,
    currentFrame: SamplePoint | null,
    panelDriverName: string,
    panelTeamName: string,
    panelSubtitle: string,
    compact: boolean,
    muted: boolean,
    onToggleMute?: () => void
  ) => {
    const speedRaw = currentFrame?.speed ?? 0;
    const speed = Math.round(speedRaw);
    const rpm = Math.round(currentFrame?.rpm ?? 0);
    const throttle = Math.round(currentFrame?.throttle ?? 0);
    const brake = Math.round(currentFrame?.brake ?? 0);
    const gear = Math.round(currentFrame?.n_gear ?? 0);
    const drsOn = Boolean((currentFrame?.drs ?? 0) > 0);
    const outerStart = 140;
    const outerSweep = 260;
    const speedEnd = outerStart + (outerSweep * clamp(speedRaw, 0, 350)) / 350;
    const throttleStart = 145;
    const throttleSweep = 120;
    const throttleEnd = throttleStart + (throttleSweep * throttle) / 100;
    const brakeStart = 35;
    const brakeSweep = 120;
    const brakeEnd = brakeStart - (brakeSweep * brake) / 100;
    const basePathId = panelId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const throttleArcLabelPathId = `${basePathId}_throttle_arc`;
    const brakeArcLabelPathId = `${basePathId}_brake_arc`;
    const speedMarks = [0, 50, 100, 150, 200, 250, 300, 350];
    const textStyle = { fontFamily: hudTechMonoFont, letterSpacing: '0.06em', fontVariantNumeric: 'tabular-nums' } as const;
    const labelStyle = { fontFamily: hudTechFont, letterSpacing: '0.12em' } as const;
    const speedMarkStyle = { fontFamily: hudTechMonoFont, letterSpacing: '0.04em', fontVariantNumeric: 'tabular-nums' } as const;

    return (
      <div className={`rounded-2xl border bg-black/70 p-4 ${muted ? 'border-white/20 opacity-70' : 'border-white/10'}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="min-w-0">
            <div className="text-xs font-mono text-text-secondary truncate">{panelSubtitle}</div>
            <div className="text-sm font-mono font-bold text-white truncate">{panelDriverName}</div>
            <div className="text-[11px] font-mono text-text-secondary truncate">{panelTeamName}</div>
          </div>
          {onToggleMute && (
            <button
              onClick={onToggleMute}
              className={`px-2.5 py-1 rounded-md text-xs font-mono border ${
                muted ? 'border-white/30 text-zinc-300' : 'border-primary/50 text-primary bg-primary/10'
              }`}
            >
              {muted ? t('telemetry.hud.unmute', 'Unmute') : t('telemetry.hud.mute', 'Mute')}
            </button>
          )}
        </div>
        <div className={`mx-auto ${compact ? 'w-[240px] h-[240px]' : 'w-[320px] h-[320px]'} relative`}>
          <svg viewBox="0 0 320 320" className="w-full h-full">
            <defs>
              <path id={throttleArcLabelPathId} d={describeArc(160, 160, 96, throttleStart + 10, throttleStart + throttleSweep - 10)} />
              <path id={brakeArcLabelPathId} d={describeArc(160, 160, 96, brakeStart - brakeSweep + 10, brakeStart - 10)} />
            </defs>
            <path d={describeArc(160, 160, 140, outerStart, outerStart + outerSweep)} stroke="rgba(255,255,255,0.15)" strokeWidth="20" fill="none" strokeLinecap="round" />
            <path d={describeArc(160, 160, 140, outerStart, speedEnd)} stroke="#1682FF" strokeWidth="20" fill="none" strokeLinecap="round" />
            <path d={describeArc(160, 160, 102, throttleStart, throttleStart + throttleSweep)} stroke="rgba(255,255,255,0.12)" strokeWidth="20" fill="none" strokeLinecap="round" />
            <path d={describeArc(160, 160, 102, throttleStart, throttleEnd)} stroke="#1ccd39ff" strokeWidth="20" fill="none" strokeLinecap="round" />
            <path d={describeArc(160, 160, 102, brakeStart, brakeStart - brakeSweep)} stroke="rgba(255,255,255,0.12)" strokeWidth="20" fill="none" strokeLinecap="round" />
            <path d={describeArc(160, 160, 102, brakeStart, brakeEnd)} stroke="#ee0004ff" strokeWidth="20" fill="none" strokeLinecap="round" />
            {speedMarks.map((mark) => {
              const angleDeg = outerStart + (outerSweep * mark) / 350;
              const angle = (Math.PI / 180) * angleDeg;
              const x = 160 + 140 * Math.cos(angle);
              const y = 160 + 140 * Math.sin(angle);
              const tangentRotation = angleDeg + 90;
              const inwardRotation = tangentRotation;
              const normalizedRotation = ((inwardRotation % 360) + 360) % 360;
              return (
                <text
                  key={mark}
                  x={x}
                  y={y}
                  transform={`rotate(${normalizedRotation} ${x} ${y})`}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-zinc-100"
                  fontSize="14"
                  fontWeight="700"
                  style={speedMarkStyle}
                >
                  {mark}
                </text>
              );
            })}
            <text className="fill-zinc-100" fontSize="14" fontWeight="700" style={labelStyle}>
              <textPath href={`#${throttleArcLabelPathId}`} startOffset="50%" textAnchor="middle">
                {t('telemetry.hud.throttle', 'THROTTLE')}
              </textPath>
            </text>
            <text className="fill-zinc-100" fontSize="14" fontWeight="700" style={labelStyle}>
              <textPath href={`#${brakeArcLabelPathId}`} startOffset="50%" textAnchor="middle">
                {t('telemetry.hud.brake', 'BRAKE')}
              </textPath>
            </text>
            <text x="160" y="140" textAnchor="middle" className="fill-white" fontSize="68" fontWeight="700" style={textStyle}>{speed}</text>
            <text x="160" y="164" textAnchor="middle" className="fill-zinc-300" fontSize="20" fontWeight="700" style={labelStyle}>KMH</text>
            <text x="160" y="208" textAnchor="middle" className="fill-white" fontSize="40" fontWeight="700" style={textStyle}>{rpm}</text>
            <text x="160" y="232" textAnchor="middle" className="fill-zinc-300" fontSize="20" fontWeight="700" style={labelStyle}>RPM</text>
            <rect x="125" y="242" width="70" height="28" rx="8" fill={drsOn ? '#12b62dff' : '#0F0F12'} />
            <text x="160" y="262" textAnchor="middle" className="fill-white" fontSize="20" fontWeight="700" style={labelStyle}>DRS</text>
            <text x="160" y="295" textAnchor="middle" className="fill-zinc-200" fontSize="18" fontWeight="700" style={labelStyle}>
              {t('telemetry.hud.gear', 'GEAR')} {gear}
            </text>
          </svg>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center">
          <div className="bg-background/60 border border-white/10 rounded-md p-2">
            <div className="text-[10px] text-text-secondary font-mono uppercase tracking-wider">{t('telemetry.hud.throttle', 'THROTTLE')}</div>
            <div className="text-sm text-white font-mono font-bold">{throttle}%</div>
          </div>
          <div className="bg-background/60 border border-white/10 rounded-md p-2">
            <div className="text-[10px] text-text-secondary font-mono uppercase tracking-wider">{t('telemetry.hud.brake', 'BRAKE')}</div>
            <div className="text-sm text-white font-mono font-bold">{brake}%</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <select
          className="bg-background border border-white/10 text-white text-sm rounded-md px-3 py-2 font-mono outline-none focus:border-primary"
          value={hudMode}
          onChange={(event) => setHudMode(event.target.value as 'latest' | 'lap_compare')}
        >
          <option value="latest">{t('telemetry.hud.view_latest', 'Latest')}</option>
          <option value="lap_compare">{t('telemetry.hud.view_lap_compare', 'Lap Compare')}</option>
        </select>
        {hudMode === 'latest' && (
          <select
            className="bg-background border border-white/10 text-white text-sm rounded-md px-3 py-2 font-mono outline-none focus:border-primary"
            value={hudDriver ?? ''}
            onChange={(event) => setHudDriver(Number(event.target.value))}
            disabled={selectedDriverNumbers.length === 0}
          >
            {selectedDriverNumbers.map((driverNumber) => {
              const selected = drivers.find((item) => item.driver_number === driverNumber);
              return (
                <option key={driverNumber} value={driverNumber}>
                  {selected?.name_acronym ?? driverNumber}
                </option>
              );
            })}
          </select>
        )}
        {hudMode === 'lap_compare' && (
          <div className="bg-background border border-white/10 rounded-md w-[260px]">
            <div className="px-3 py-1 border-b border-white/10 text-[11px] font-mono text-text-secondary">
              {t('telemetry.hud.lap_picker_hint', 'Pick up to 4 laps')} ({selectedLapSlots.length}/4)
            </div>
            <div className="max-h-[120px] overflow-y-auto custom-scrollbar">
              {lapSeriesOptions.map((option) => {
                const selected = selectedLapSlots.includes(option.key);
                const atLimit = selectedLapSlots.length >= 4 && !selected;
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={atLimit}
                    onClick={() => {
                      setSelectedLapSlots((prev) => {
                        if (prev.includes(option.key)) return prev.filter((key) => key !== option.key);
                        if (prev.length >= 4) return prev;
                        return [...prev, option.key];
                      });
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm font-mono border-b border-white/5 last:border-b-0 transition-colors ${
                      selected
                        ? 'bg-primary/15 text-primary'
                        : atLimit
                        ? 'text-zinc-500 cursor-not-allowed'
                        : 'text-white hover:bg-white/5'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <button
          onClick={() => setIsPlaying((prev) => !prev)}
          className="px-3 py-2 rounded-md text-sm font-mono border border-white/10 bg-background text-white hover:border-primary/50"
        >
          {isPlaying ? t('telemetry.hud.pause', 'Pause') : t('telemetry.hud.play', 'Play')}
        </button>
        <button
          onClick={() => {
            setElapsedMs(0);
            if (hudMode === 'latest' && points.length > 0) setFrame(points[0]);
            anchorRef.current = { wallTime: performance.now(), elapsed: 0 };
            setIsPlaying(true);
          }}
          className="px-3 py-2 rounded-md text-sm font-mono border border-white/10 bg-background text-white hover:border-primary/50"
        >
          {t('telemetry.hud.reset', 'Reset')}
        </button>
        <button
          onClick={handleSoundToggle}
          className={`px-3 py-2 rounded-md text-sm font-mono border transition-colors ${
            soundEnabled
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-white/10 bg-background text-white hover:border-primary/50'
          }`}
        >
          {soundEnabled ? t('telemetry.hud.sound_off', 'Sound OFF') : t('telemetry.hud.sound_on', 'Sound ON')}
        </button>
        <select
          className="bg-background border border-white/10 text-white text-sm rounded-md px-3 py-2 font-mono outline-none focus:border-primary"
          value={playbackSpeed}
          onChange={(event) => setPlaybackSpeed(Number(event.target.value))}
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1.0x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2.0x</option>
        </select>
        <div className="min-w-[220px] px-1 py-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-text-secondary mb-1">
            <span>{t('telemetry.hud.progress', 'Progress')}</span>
            <span>{progress.toFixed(1)}%</span>
          </div>
          <div
            ref={progressTrackRef}
            className="relative h-2 cursor-pointer touch-none"
            onPointerDown={handleProgressPointerDown}
            onPointerMove={handleProgressPointerMove}
            onPointerUp={handleProgressPointerUp}
            onPointerCancel={handleProgressPointerUp}
          >
            <div className="absolute inset-0 rounded bg-white/10 border border-white/10" />
            <div
              className="absolute inset-y-0 left-0 rounded bg-primary transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-white/40 bg-primary"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
          </div>
        </div>
      </div>

      {hudMode === 'latest' ? (
        <div>
          {renderHudPanel(
            'latest',
            frame,
            driver?.full_name ?? '-',
            driver?.team_name ?? '-',
            t('telemetry.hud.current_driver', 'Current Driver'),
            false,
            false
          )}
        </div>
      ) : (
        <div className={`grid gap-4 ${selectedLapSlots.length <= 1 ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
          {compareFrames.map((slot) => {
            const muted = mutedLapSlots.includes(slot.key);
            return (
              <div key={slot.key}>
                {renderHudPanel(
                  slot.key,
                  slot.frame,
                  slot.driver?.full_name ?? `Driver ${slot.driverNumber}`,
                  slot.driver?.team_name ?? '-',
                  `${slot.driver?.name_acronym ?? slot.driverNumber} · ${t('telemetry.hud.lap', 'Lap')} ${slot.lapNumber}`,
                  true,
                  muted,
                  () =>
                    setMutedLapSlots((prev) =>
                      prev.includes(slot.key) ? prev.filter((key) => key !== slot.key) : [...prev, slot.key]
                    )
                )}
              </div>
            );
          })}
        </div>
      )}

      {hudMode === 'latest' && points.length === 0 && (
        <div className="text-text-secondary font-mono text-sm">
          {t('telemetry.hud.no_data', 'No telemetry stream is available for this driver in the selected session.')}
        </div>
      )}
      {hudMode === 'lap_compare' && selectedLapSlots.length === 0 && (
        <div className="text-text-secondary font-mono text-sm">
          {t('telemetry.hud.no_lap_selection', 'Pick at least one lap to render compare HUDs.')}
        </div>
      )}
    </div>
  );
};

export default RealTimeHud;
