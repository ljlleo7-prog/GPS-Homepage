import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Activity, Car, Clock, Gauge, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useTelemetryStore } from '../../store/telemetryStore';
import TelemetryChart from './TelemetryChart';
import LapAnalysis from './LapAnalysis';
import DriverAnalysis from './DriverAnalysis';
import RealTimeHud from './RealTimeHud';

const Telemetry = () => {
  const { t } = useTranslation();
  const { 
    sessions, 
    drivers, 
    selectedSessionKey, 
    selectedDriverNumbers,
    interpolation,
    fetchSessions,
    setSelectedSession,
    toggleDriverSelection,
    setInterpolationEnabled,
    setMetricInterpolation
  } = useTelemetryStore();

  const [activeTab, setActiveTab] = useState<'chart' | 'laps' | 'drivers' | 'hud'>('chart');
  const [liveMode, setLiveMode] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [showInterpolationPanel, setShowInterpolationPanel] = useState(false);

  useEffect(() => {
    fetchSessions(selectedYear);
  }, [fetchSessions, selectedYear]);

  return (
    <div className="min-h-screen bg-background pt-24 pb-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold font-mono text-white mb-2 flex items-center">
                <Activity className="w-8 h-8 mr-3 text-primary" />
                {t('telemetry.title', 'Live Telemetry Analysis')}
              </h1>
              <p className="text-text-secondary font-mono text-sm">
                {t('telemetry.subtitle', 'Powered by OpenF1 API. In-memory cache enabled.')}
              </p>
            </div>

            <div className="flex items-center gap-3 bg-surface p-2 rounded-lg border border-white/5 flex-wrap justify-end">
              <select
                className="bg-background border border-white/10 text-white text-sm rounded-md px-3 py-2 font-mono outline-none focus:border-primary"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
              >
                {[2023, 2024, 2025, 2026].map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>

              <select 
                className="bg-background border border-white/10 text-white text-sm rounded-md px-3 py-2 font-mono outline-none focus:border-primary max-w-[200px]"
                value={selectedSessionKey || ''}
                onChange={(e) => setSelectedSession(Number(e.target.value))}
              >
                <option value="" disabled>{t('telemetry.select_session', 'Select Session')}</option>
                {sessions.map(session => (
                  <option key={session.session_key} value={session.session_key}>
                    {session.year} {session.country_name} - {session.session_name}
                  </option>
                ))}
              </select>

              <button
                onClick={() => setLiveMode(!liveMode)}
                className={`flex items-center px-3 py-2 rounded-md text-sm font-mono transition-colors ${
                  liveMode 
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30' 
                    : 'bg-background text-text-secondary border border-white/10 hover:border-primary/50'
                }`}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${liveMode ? 'animate-spin' : ''}`} />
                {liveMode ? t('telemetry.live_on', 'LIVE ON') : t('telemetry.live_off', 'LIVE OFF')}
              </button>

              <button
                onClick={() => setInterpolationEnabled(!interpolation.enabled)}
                className={`flex items-center px-3 py-2 rounded-md text-sm font-mono transition-colors ${
                  interpolation.enabled
                    ? 'bg-primary/10 text-primary border border-primary/40'
                    : 'bg-background text-text-secondary border border-white/10 hover:border-primary/50'
                }`}
              >
                {interpolation.enabled
                  ? t('telemetry.interpolation.on', 'Interpolation ON')
                  : t('telemetry.interpolation.off', 'Interpolation OFF')}
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowInterpolationPanel((prev) => !prev)}
                  className="flex items-center px-3 py-2 rounded-md text-sm font-mono bg-background text-text-secondary border border-white/10 hover:border-primary/50"
                >
                  <SlidersHorizontal className="w-4 h-4 mr-2" />
                  {t('telemetry.interpolation.metric_settings', 'Metric Settings')}
                </button>
                {showInterpolationPanel && (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-[250px] bg-background border border-white/10 rounded-md shadow-lg p-3 space-y-2">
                    {([
                      { key: 'speed', label: t('telemetry.metrics.speed', 'Speed') },
                      { key: 'rpm', label: t('telemetry.metrics.rpm', 'RPM') },
                      { key: 'throttle', label: t('telemetry.metrics.throttle', 'Throttle') },
                      { key: 'brake', label: t('telemetry.metrics.brake', 'Brake') },
                      { key: 'n_gear', label: t('telemetry.metrics.gear', 'Gear') }
                    ] as const).map((item) => (
                      <label key={item.key} className="flex items-center justify-between text-xs font-mono text-white">
                        <span>{item.label}</span>
                        <input
                          type="checkbox"
                          className="accent-cyan-400"
                          checked={interpolation.metrics[item.key]}
                          onChange={(e) => setMetricInterpolation(item.key, e.target.checked)}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {selectedSessionKey ? (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            
            {/* Drivers Sidebar */}
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-surface rounded-lg border border-white/5 p-4">
                <h3 className="text-white font-mono font-bold mb-4 flex items-center text-sm uppercase tracking-wider">
                  <Car className="w-4 h-4 mr-2 text-primary" />
                  {t('telemetry.driver_list', 'Drivers (Max 3)')}
                </h3>
                <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {drivers.map(driver => {
                    const isSelected = selectedDriverNumbers.includes(driver.driver_number);
                    return (
                      <button
                        key={driver.driver_number}
                        onClick={() => toggleDriverSelection(driver.driver_number)}
                        className={`w-full text-left p-3 rounded-md border transition-all flex items-center justify-between ${
                          isSelected 
                            ? 'bg-primary/10 border-primary/50' 
                            : 'bg-background border-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-2 h-8 rounded-sm" 
                            style={{ backgroundColor: `#${driver.team_colour}` }}
                          />
                          <div>
                            <div className="text-white font-mono text-sm font-bold">
                              {driver.name_acronym} <span className="text-text-secondary text-xs">{driver.driver_number}</span>
                            </div>
                            <div className="text-text-secondary text-xs truncate max-w-[100px]">
                              {driver.team_name}
                            </div>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="w-3 h-3 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--color-primary),0.8)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-3">
              {/* Tabs */}
              <div className="flex space-x-2 mb-6 bg-surface p-1 rounded-lg border border-white/5 inline-flex">
                <button
                  onClick={() => setActiveTab('chart')}
                  className={`px-4 py-2 rounded-md font-mono text-sm flex items-center transition-all ${
                    activeTab === 'chart' 
                      ? 'bg-primary text-background' 
                      : 'text-text-secondary hover:text-white'
                  }`}
                >
                  <Activity className="w-4 h-4 mr-2" />
                  {t('telemetry.tabs.chart', 'Telemetry Chart')}
                </button>
                <button
                  onClick={() => setActiveTab('laps')}
                  className={`px-4 py-2 rounded-md font-mono text-sm flex items-center transition-all ${
                    activeTab === 'laps' 
                      ? 'bg-primary text-background' 
                      : 'text-text-secondary hover:text-white'
                  }`}
                >
                  <Clock className="w-4 h-4 mr-2" />
                  {t('telemetry.tabs.laps', 'Lap Analysis')}
                </button>
                <button
                  onClick={() => setActiveTab('drivers')}
                  className={`px-4 py-2 rounded-md font-mono text-sm flex items-center transition-all ${
                    activeTab === 'drivers' 
                      ? 'bg-primary text-background' 
                      : 'text-text-secondary hover:text-white'
                  }`}
                >
                  <Car className="w-4 h-4 mr-2" />
                  {t('telemetry.tabs.drivers', 'Driver Stats')}
                </button>
                <button
                  onClick={() => setActiveTab('hud')}
                  className={`px-4 py-2 rounded-md font-mono text-sm flex items-center transition-all ${
                    activeTab === 'hud'
                      ? 'bg-primary text-background'
                      : 'text-text-secondary hover:text-white'
                  }`}
                >
                  <Gauge className="w-4 h-4 mr-2" />
                  {t('telemetry.tabs.hud', 'Real-time HUD')}
                </button>
              </div>

              {/* Content */}
              <div className="bg-surface rounded-lg border border-white/5 p-6 min-h-[500px]">
                {selectedDriverNumbers.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-text-secondary font-mono">
                    {t('telemetry.select_driver_prompt', 'Please select at least one driver from the sidebar.')}
                  </div>
                ) : (
                  <>
                    {activeTab === 'chart' && <TelemetryChart liveMode={liveMode} />}
                    {activeTab === 'laps' && <LapAnalysis />}
                    {activeTab === 'drivers' && <DriverAnalysis liveMode={liveMode} />}
                    {activeTab === 'hud' && <RealTimeHud liveMode={liveMode} />}
                  </>
                )}
              </div>
            </div>

          </div>
        ) : (
          <div className="flex justify-center items-center h-64 text-text-secondary font-mono">
            {t('telemetry.loading_sessions', 'Loading sessions...')}
          </div>
        )}

      </div>
    </div>
  );
};

export default Telemetry;
