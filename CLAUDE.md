# CLAUDE.md

Use English in conversation unless otherwise specified.
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development commands

- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Build production bundle: `npm run build`
- Preview built app: `npm run preview`
- Lint: `npm run lint`
- Type-check: `npm run check`
- Deploy static build to GitHub Pages: `npm run deploy`

## Testing

- There is currently no test runner configured in `package.json`.
- There is no repo-defined command for running a single test.
- For verification, use `npm run check` and `npm run lint`, and if needed run the Vite app locally with `npm run dev`.

## Environment and runtime

- Frontend env vars are required in `.env`:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- `src/lib/supabase.ts` throws at startup if either env var is missing.
- Auth session persistence is customized to store Supabase auth state in cookies so sessions can work across GPS subdomains.

## High-level architecture

### App shell and providers

- Entry point is `src/main.tsx`, which renders `App` and loads global CSS and i18n.
- `src/App.tsx` wraps the app with:
  1. `I18nextProvider`
  2. `AuthProvider`
  3. `EconomyProvider`
  4. `BrowserRouter`
- Routing is centralized in `src/App.tsx`. Most pages render inside `src/components/layout/Layout.tsx`, which provides the navbar, footer, disclaimer banner, and global username setup modal.

### Main architectural split

The app is a Vite/React SPA with most business behavior split across three layers:

1. **Page-level screens** in `src/pages/*`
   - Own route-level data loading and page composition.
   - Major product areas include wallet/economy, missions, support markets, forum, news, minigames, and developer inbox.

2. **Shared state/providers** in `src/context/*`
   - `AuthContext` is the source of truth for the current Supabase user/session.
   - `EconomyContext` is the main client-side service layer for the gamified economy. It exposes wallet state plus most privileged user actions as async methods.

3. **Supabase backend**
   - UI code directly queries tables with `supabase.from(...)` for reads.
   - Most important mutations and domain logic are implemented as Supabase RPCs/functions and invoked from the frontend via `supabase.rpc(...)`.
   - Schema evolution lives in `supabase/migrations/*.sql` and is extensive; when behavior is unclear, check the corresponding SQL function before changing frontend assumptions.

### Auth and user bootstrap

- `src/context/AuthContext.tsx` initializes the current session with `supabase.auth.getSession()` and subscribes to auth state changes.
- Components typically gate behavior using `useAuth()` rather than passing user/session props.
- `src/components/common/UsernameSetupModal.tsx` is mounted globally from the layout and relies on economy/profile state to force username completion.

### Economy system as the core domain

- `src/context/EconomyContext.tsx` is the central integration point for the app’s community economy.
- It loads and exposes:
  - wallet balances
  - recent ledger entries
  - developer approval state
  - username/profile-derived state
  - test-player decline notifications
- It also wraps the major product actions, including:
  - daily bonus claims
  - developer access workflow
  - mission-related reward flows
  - support market / ticket market actions
  - driver bets and user-created campaigns
  - minigame reward submission and monthly leaderboard queries
- Many pages/components depend on `useEconomy()` for both permissions and mutations. If a feature touches tokens, reputation, approvals, ticket trading, or minigame rewards, start in `EconomyContext`.

### Supabase-driven feature areas

#### Support markets and ticket economy

- `src/pages/SupportMarkets.tsx` is the largest market UI and mixes direct table reads with many RPC calls.
- The system currently supports legacy instrument concepts (`BOND`, `INDEX`, `MILESTONE`) plus newer ticket-based market/campaign flows.
- Price/trend behavior depends heavily on backend functions such as authoritative price lookups, yesterday averages, ticket-holder queries, and sale/purchase RPCs.
- `src/components/economy/TicketMarket.tsx` and `src/components/economy/PriceTrend.tsx` are supporting pieces for ticket listings, holdings, and chart/trend views.

#### Developer inbox / admin workflows

- `src/pages/DeveloperInbox.tsx` is the operational console for approved developers.
- It aggregates moderation and approval workflows through the `get_developer_inbox` RPC and related mutation RPCs.
- This page covers developer approvals, mission review, forum acknowledgements, driver bet resolution, test-player requests, and deliverable scheduling/processing.

#### Forum and community content

- `src/pages/Forum.tsx` reads forum rooms/posts/comments directly from Supabase tables.
- Room creation and reward acknowledgements are RPC-driven, while likes/comments/posts are mostly table operations.
- Posting permissions depend on wallet reputation and some moderation/admin actions depend on developer approval state.

#### News/content pages

- News pages use Supabase-backed article/comment flows.
- `src/hooks/useSiteContent.ts` reads a simple `site_content` key/value table and provides defaults if the table is absent.

#### Minigames

- `src/pages/Minigame.tsx` is a selector page for multiple minigames.
- Current minigames include reaction, one-lap duel, pit stop, and GT pit stop.
- Reward writes and leaderboard/pool reads are funneled through economy-context methods backed by RPCs.
- One Lap Duel has its own submodule under `src/components/minigame/OneLapDuel/*` with lobby, room, leaderboard, dashboard, simulation logic, and types.

### Internationalization

- `src/i18n.ts` wires `i18next` with English and Simplified Chinese resources.
- Translation files live in:
  - `src/locales/en/translation.json`
  - `src/locales/zh/translation.json`
- UI changes that add user-facing text usually need updates to both locale files.

### Build/tooling notes

- Package manager is npm (`package-lock.json` is committed).
- Vite config is in `vite.config.ts`.
- TS path alias `@/*` maps to `src/*` via `tsconfig.json` and `vite-tsconfig-paths`.
- Production builds use hidden sourcemaps and copy `dist/index.html` to `dist/404.html` for SPA hosting.
- TypeScript strictness is relaxed (`strict: false`), so existing code may rely on looser typing than a strict TS project.

## Working norms specific to this repo

- Prefer tracing business rules through Supabase migrations/functions before changing frontend logic; many seemingly simple UI actions depend on RPC-side constraints and side effects.
- When editing economy, forum, market, mission, or minigame flows, check whether the change belongs in frontend code, SQL migrations, or both.
- When adding UI copy, keep English and Chinese translations in sync.
- Be careful around existing uncommitted SQL migrations and feature work; this repo often carries ongoing schema changes alongside frontend edits.
