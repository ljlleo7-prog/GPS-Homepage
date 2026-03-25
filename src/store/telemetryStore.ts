import { create } from 'zustand';

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  headshot_url: string;
}

export interface Session {
  session_key: number;
  session_name: string;
  date_start: string;
  date_end: string;
  circuit_short_name: string;
  country_name: string;
  year: number;
}

export interface TelemetryData {
  date: string;
  session_key: number;
  meeting_key: number;
  driver_number: number;
  speed: number;
  rpm: number;
  throttle: number;
  brake: number;
  n_gear: number;
  drs: number | null;
}

export interface LapData {
  lap_number: number;
  driver_number: number;
  lap_duration: number;
  sector_1: number;
  sector_2: number;
  sector_3: number;
  is_pit_out_lap: boolean;
  date_start: string;
}

export type InterpolationMetricKey = 'speed' | 'rpm' | 'throttle' | 'brake' | 'n_gear';

export interface InterpolationSettings {
  enabled: boolean;
  metrics: Record<InterpolationMetricKey, boolean>;
}

export interface TelemetryLoadState {
  isLoading: boolean;
  progress: number;
  loadedPoints: number;
  mode: 'idle' | 'initial' | 'live';
  error?: string;
}

interface TelemetryState {
  sessions: Session[];
  drivers: Driver[];
  selectedSessionKey: number | null;
  selectedDriverNumbers: number[];
  
  // Cache data
  telemetryCache: Record<number, Record<number, TelemetryData[]>>; // session_key -> driver_number -> data
  lapCache: Record<number, Record<number, LapData[]>>; // session_key -> driver_number -> laps
  telemetryLoadState: Record<number, Record<number, TelemetryLoadState>>;
  lapLoadingState: Record<number, Record<number, boolean>>;
  interpolation: InterpolationSettings;

  // Fetch functions
  fetchSessions: (year?: number) => Promise<void>;
  fetchDrivers: (sessionKey: number) => Promise<void>;
  fetchTelemetry: (sessionKey: number, driverNumber: number, live?: boolean) => Promise<void>;
  fetchLaps: (sessionKey: number, driverNumber: number) => Promise<void>;

  // Setters
  setSelectedSession: (sessionKey: number) => void;
  toggleDriverSelection: (driverNumber: number) => void;
  setInterpolationEnabled: (enabled: boolean) => void;
  setMetricInterpolation: (metric: InterpolationMetricKey, enabled: boolean) => void;
  clearCache: () => void;
}

const API_BASE = 'https://api.openf1.org/v1';

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  sessions: [],
  drivers: [],
  selectedSessionKey: null,
  selectedDriverNumbers: [],
  telemetryCache: {},
  lapCache: {},
  telemetryLoadState: {},
  lapLoadingState: {},
  interpolation: {
    enabled: true,
    metrics: {
      speed: true,
      rpm: true,
      throttle: true,
      brake: true,
      n_gear: false
    }
  },

  fetchSessions: async (year) => {
    try {
      const url = year ? `${API_BASE}/sessions?year=${year}` : `${API_BASE}/sessions?session_key=latest`;
      const res = await fetch(url);
      const data = await res.json();
      const sessionsArray = Array.isArray(data) ? data : [data];
      set({ sessions: sessionsArray });
      
      // Auto select latest session from this year if none selected or if selected is not in this year
      const currentSelected = get().selectedSessionKey;
      const isValid = sessionsArray.some(s => s.session_key === currentSelected);
      if ((!currentSelected || !isValid) && sessionsArray.length > 0) {
        get().setSelectedSession(sessionsArray[sessionsArray.length - 1].session_key);
      }
    } catch (error) {
      console.error('Error fetching sessions:', error);
    }
  },

  fetchDrivers: async (sessionKey) => {
    try {
      const res = await fetch(`${API_BASE}/drivers?session_key=${sessionKey}`);
      const data = await res.json();
      set({ drivers: data });
    } catch (error) {
      console.error('Error fetching drivers:', error);
    }
  },

  fetchTelemetry: async (sessionKey, driverNumber, live = false) => {
    try {
      const state = get();
      const cache = state.telemetryCache;
      const existingData = cache[sessionKey]?.[driverNumber] || [];
      const currentLoadState = state.telemetryLoadState[sessionKey]?.[driverNumber];

      if (currentLoadState?.isLoading) {
        return;
      }

      if (!live && existingData.length > 0) {
        set((prev) => ({
          telemetryLoadState: {
            ...prev.telemetryLoadState,
            [sessionKey]: {
              ...(prev.telemetryLoadState[sessionKey] || {}),
              [driverNumber]: {
                isLoading: false,
                progress: 100,
                loadedPoints: existingData.length,
                mode: 'idle'
              }
            }
          }
        }));
        return;
      }

      set((prev) => ({
        telemetryLoadState: {
          ...prev.telemetryLoadState,
          [sessionKey]: {
            ...(prev.telemetryLoadState[sessionKey] || {}),
            [driverNumber]: {
              isLoading: true,
              progress: live ? 100 : 0,
              loadedPoints: existingData.length,
              mode: live ? 'live' : 'initial'
            }
          }
        }
      }));

      if (live && existingData.length > 0) {
        let url = `${API_BASE}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}`;
        const lastDate = existingData[existingData.length - 1].date;
        url += `&date>=${encodeURIComponent(lastDate)}`;
        const res = await fetch(url);
        let newData = await res.json();
        if (!Array.isArray(newData)) {
          newData = [];
        }
        if (newData.length > 0 && newData[0].date === existingData[existingData.length - 1].date) {
          newData.shift();
        }
        if (newData.length > 0) {
          set((prev) => {
            const nextCache = { ...prev.telemetryCache };
            if (!nextCache[sessionKey]) nextCache[sessionKey] = {};
            nextCache[sessionKey][driverNumber] = [...existingData, ...newData];
            return { telemetryCache: nextCache };
          });
        }
        const finalCount = existingData.length + newData.length;
        set((prev) => ({
          telemetryLoadState: {
            ...prev.telemetryLoadState,
            [sessionKey]: {
              ...(prev.telemetryLoadState[sessionKey] || {}),
              [driverNumber]: {
                isLoading: false,
                progress: 100,
                loadedPoints: finalCount,
                mode: 'idle'
              }
            }
          }
        }));
        return;
      }

      const targetSession = state.sessions.find((item) => item.session_key === sessionKey);
      const startMs = targetSession?.date_start ? new Date(targetSession.date_start).getTime() : Number.NaN;
      const endFromSession = targetSession?.date_end ? new Date(targetSession.date_end).getTime() : Date.now();
      const endMs = Number.isNaN(endFromSession) ? Date.now() : endFromSession;

      if (targetSession && !Number.isNaN(startMs) && endMs > startMs) {
        const chunkMs = 5 * 60 * 1000;
        let cursor = startMs;
        let collected: TelemetryData[] = [];
        while (cursor < endMs) {
          const nextCursor = Math.min(cursor + chunkMs, endMs);
          const startIso = new Date(cursor).toISOString();
          const endIso = new Date(nextCursor).toISOString();
          const url = `${API_BASE}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${encodeURIComponent(startIso)}&date<${encodeURIComponent(endIso)}`;
          const response = await fetch(url);
          const payload = await response.json();
          const points = Array.isArray(payload) ? payload as TelemetryData[] : [];
          if (points.length > 0) {
            collected = [...collected, ...points];
          }
          const progress = Math.round(((nextCursor - startMs) / (endMs - startMs)) * 100);
          const loadedPoints = collected.length;
          set((prev) => ({
            telemetryCache: {
              ...prev.telemetryCache,
              [sessionKey]: {
                ...(prev.telemetryCache[sessionKey] || {}),
                [driverNumber]: collected
              }
            },
            telemetryLoadState: {
              ...prev.telemetryLoadState,
              [sessionKey]: {
                ...(prev.telemetryLoadState[sessionKey] || {}),
                [driverNumber]: {
                  isLoading: true,
                  progress,
                  loadedPoints,
                  mode: 'initial'
                }
              }
            }
          }));
          cursor = nextCursor;
        }
        set((prev) => {
          const nextCache = { ...prev.telemetryCache };
          if (!nextCache[sessionKey]) nextCache[sessionKey] = {};
          nextCache[sessionKey][driverNumber] = collected;
          return { telemetryCache: nextCache };
        });
        set((prev) => ({
          telemetryLoadState: {
            ...prev.telemetryLoadState,
            [sessionKey]: {
              ...(prev.telemetryLoadState[sessionKey] || {}),
              [driverNumber]: {
                isLoading: false,
                progress: 100,
                loadedPoints: collected.length,
                mode: 'idle'
              }
            }
          }
        }));
        return;
      }

      const fallbackUrl = `${API_BASE}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}`;
      const fallbackResponse = await fetch(fallbackUrl);
      const fallbackPayload = await fallbackResponse.json();
      const fallbackData = Array.isArray(fallbackPayload) ? fallbackPayload as TelemetryData[] : [];
      set((prev) => {
        const nextCache = { ...prev.telemetryCache };
        if (!nextCache[sessionKey]) nextCache[sessionKey] = {};
        nextCache[sessionKey][driverNumber] = fallbackData;
        return { telemetryCache: nextCache };
      });
      set((prev) => ({
        telemetryLoadState: {
          ...prev.telemetryLoadState,
          [sessionKey]: {
            ...(prev.telemetryLoadState[sessionKey] || {}),
            [driverNumber]: {
              isLoading: false,
              progress: 100,
              loadedPoints: fallbackData.length,
              mode: 'idle'
            }
          }
        }
      }));
    } catch (error) {
      console.error('Error fetching telemetry:', error);
      const cachedCount = get().telemetryCache[sessionKey]?.[driverNumber]?.length || 0;
      set((prev) => ({
        telemetryLoadState: {
          ...prev.telemetryLoadState,
          [sessionKey]: {
            ...(prev.telemetryLoadState[sessionKey] || {}),
            [driverNumber]: {
              isLoading: false,
              progress: 0,
              loadedPoints: cachedCount,
              mode: 'idle',
              error: error instanceof Error ? error.message : 'Unknown error'
            }
          }
        }
      }));
    }
  },

  fetchLaps: async (sessionKey, driverNumber) => {
    try {
      const state = get();
      const existingLaps = state.lapCache[sessionKey]?.[driverNumber] || [];
      const isLapLoading = Boolean(state.lapLoadingState[sessionKey]?.[driverNumber]);
      if (existingLaps.length > 0 || isLapLoading) {
        return;
      }
      set((prev) => ({
        lapLoadingState: {
          ...prev.lapLoadingState,
          [sessionKey]: {
            ...(prev.lapLoadingState[sessionKey] || {}),
            [driverNumber]: true
          }
        }
      }));
      const res = await fetch(`${API_BASE}/laps?session_key=${sessionKey}&driver_number=${driverNumber}`);
      const data = await res.json();
      
      if (Array.isArray(data)) {
        set((prev) => {
          const newCache = { ...prev.lapCache };
          if (!newCache[sessionKey]) newCache[sessionKey] = {};
          newCache[sessionKey][driverNumber] = data;
          return { lapCache: newCache };
        });
      }
    } catch (error) {
      console.error('Error fetching laps:', error);
    } finally {
      set((prev) => ({
        lapLoadingState: {
          ...prev.lapLoadingState,
          [sessionKey]: {
            ...(prev.lapLoadingState[sessionKey] || {}),
            [driverNumber]: false
          }
        }
      }));
    }
  },

  setSelectedSession: (sessionKey) => {
    set({ selectedSessionKey: sessionKey, selectedDriverNumbers: [] });
    get().fetchDrivers(sessionKey);
  },

  toggleDriverSelection: (driverNumber) => {
    set((state) => {
      const current = state.selectedDriverNumbers;
      if (current.includes(driverNumber)) {
        return { selectedDriverNumbers: current.filter(d => d !== driverNumber) };
      } else {
        // Max 3 drivers for performance reasons
        if (current.length >= 3) {
          return { selectedDriverNumbers: [...current.slice(1), driverNumber] };
        }
        return { selectedDriverNumbers: [...current, driverNumber] };
      }
    });
  },

  setInterpolationEnabled: (enabled) => {
    set((state) => ({
      interpolation: {
        ...state.interpolation,
        enabled
      }
    }));
  },

  setMetricInterpolation: (metric, enabled) => {
    set((state) => ({
      interpolation: {
        ...state.interpolation,
        metrics: {
          ...state.interpolation.metrics,
          [metric]: enabled
        }
      }
    }));
  },

  clearCache: () => {
    set({ telemetryCache: {}, lapCache: {}, telemetryLoadState: {}, lapLoadingState: {} });
  }
}));
