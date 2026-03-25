# Telemetry Analysis Page Implementation Plan

## Objective

Implement a new page for live telemetry analysis using the OpenF1 API (`https://api.openf1.org/v1/`). The page will provide graphic analysis, per-lap analysis, and per-driver analysis with in-memory caching.

The user should be able to choose which telemetry aspects to analyze. Later there will also be various demonstrators (like G-force circle, throttle-brake arc, RPM gradient, etc.) and statistical analysis (like max, min, avg, max derivative, best fit curve, ...)

## Steps

### 1. Install Dependencies

* Install `recharts` for graphical analysis: `npm install recharts`

* Install `date-fns` (if not already present) for time manipulation.

### 2. Update Routing & Product Link

* Update `src/App.tsx` to include the new route: `<Route path="/telemetry" element={<Telemetry />} />`

* Update `src/pages/Products.tsx` to set the URL for the telemetry product to `/telemetry`.

* Update `src/components/products/ProductCard.tsx` to handle internal links using `react-router-dom` `useNavigate` if the URL starts with `/`.

### 3. Create OpenF1 API Hooks and Store

Create `src/store/telemetryStore.ts` using `zustand` to manage data fetching and caching:

* Use Zustand to hold the in-memory cache of telemetry data (persists across component re-renders and tab switches without using localStorage).

* Implement functions to fetch:

  * `sessions?session_key=latest`

  * `drivers?session_key=latest`

  * `laps?session_key=latest&driver_number=...`

  * `car_data?session_key=latest&driver_number=...`

* Implement live polling using the `date>=` filter to only fetch new data and append it to the Zustand store.

### 4. Build Telemetry Components

Create a new directory `src/pages/Telemetry/` and build the following components:

* `index.tsx`: Main page layout, with a driver selector and tabs for different analyses.

* `TelemetryChart.tsx`: A `recharts` component showing Speed, RPM, Throttle, and Brake over time/distance.

* `DriverAnalysis.tsx`: A component showing current driver stats, team info, and live metrics.

* `LapAnalysis.tsx`: A table or chart displaying per-lap times, sector times, and lap comparisons.

### 5. Internationalization (i18n)

* Add necessary translation keys for the Telemetry page to `en.json` and `zh.json`.

### 6. User Interactions

* Users shoule be able to select which laps, which session, which track, which year, which drivers to analyze. Not only speed will be included but all possible telemetry choices should be available.

### 7. Review & Test

* Run the app and navigate to `/telemetry`.

* Ensure the live polling does not cause memory leaks or excessive re-renders.

* Verify that charts display correctly with the data fetched from OpenF1 API.

