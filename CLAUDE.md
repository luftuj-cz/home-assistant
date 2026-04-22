# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LUFTaTOR** is a React + TypeScript UI for managing Luftator ventilation valves in Home Assistant. The application has two independent parts:

- **Frontend**: React 19 + TypeScript web app built with Vite, delivered as static assets
- **Backend**: Node.js + Express server running in a Home Assistant add-on container

The frontend communicates with the backend via REST API (`/api/*`) and WebSocket (`/ws`) for real-time updates.

## Development Commands

### Frontend (root directory) – Vite+

- `npm install` – Install all dependencies (frontend and backend)
- `npm run dev` – Start Vite+ dev server at http://localhost:5173 with HMR (via `vp dev --host`)
- `npm run build` – Type-check and build production assets into `dist/` (via `vp build` with Rolldown)
- `npm run build:addon` – Build frontend AND sync output to addon rootfs in one step (use this for final builds)
- `npm run preview` – Preview production build locally (via `vp preview`)
- `npm run check` – Run Oxlint (linting), Oxfmt (formatting), and TypeScript checks in one pass
- `npm run lint` – Run Oxlint on entire project (alias for `npm run check`)
- `npm run format` / `npm run format:check` – Format code with Oxfmt / check formatting

**Vite+ Unified Toolchain:**

- Replaces: Vite + esbuild + ESLint + Prettier
- Uses: Vite 8 (dev server) + Rolldown (bundler) + Oxlint (linter) + Oxfmt (formatter)
- Config: `vite.config.ts`, `oxlint.config.ts`, `.oxfmtrc.json`

### Backend (addon/rootfs/usr/src/app)

- `npm run dev` – Start backend dev server (auto-reloading with tsx watch)
- `npm start` – Run backend once (for production)
- `npm run build` – TypeScript compilation check
- `npm test` – Run Vitest tests
- `npm run lint` – Run Oxlint on backend code (uses root oxlint.config.ts)
- `npm run format` / `npm run format:check` – Format with Oxfmt (uses root .oxfmtrc.json)

### Common Workflows

- **Local full-stack development**:
  1. In root: `npm run dev` (Vite+ frontend with HMR)
  2. In `addon/rootfs/usr/src/app`: `npm run dev` (backend with tsx watch)
  3. Create `.env` in `addon/rootfs/usr/src/app` with `HA_BASE_URL`, `HA_TOKEN`, `PORT=8000`
  4. Frontend proxies API calls to backend via Vite config
- **Testing**: `npm test` (runs backend tests from root)
- **Code Quality**: `npm run check` (Oxlint + Oxfmt + TypeScript in one pass)
- **Production build for add-on**: `npm run build:addon` (one command, includes type-checking and sync)
- **Version bumping**: `node scripts/set-version.mjs --stable 1.2.3` or `--dev 1.2.3` (updates frontend, backend, and add-on config together)

## Code Architecture

### Frontend Structure (`src/`)

**Routing** (TanStack React Router with hash-based navigation):

- `src/router.tsx` – Route definitions (Dashboard, Valves, Timeline, Settings, Debug, Onboarding)
- `src/layouts/AppLayout.tsx` – Root layout with navigation
- `src/pages/` – Page components (one per route)

**Component Organization**:

- `src/components/` – Reusable UI components (ValveCard, StatusCard, etc.)
- `src/components/dashboard/` – Dashboard-specific components
- `src/components/timeline/` – Timeline-specific components

**Data Management**:

- `src/api/` – API client functions (hru.ts, timeline.ts, valves.ts)
- `src/hooks/` – Custom React hooks for data fetching (useTimelineEvents, useDashboardStatus, etc.)
- `src/features/timeline/` – Timeline-specific business logic (hooks, utilities, validators)

**Internationalization**:

- `src/i18n/` – i18next setup and locale files
- Locales in `src/i18n/locales/{en,cs}/common.json` and `addon/rootfs/usr/src/app/src/locales/`
- Build process copies backend locales to frontend during `npm run build`

**Styling**:

- Mantine v9 for component library with custom theme in `src/App.tsx`
- Notifications at bottom-left with motion animations (framer-motion)

**Utilities**:

- `src/utils/api.ts` – API URL resolution (supports custom VITE_API_BASE_URL)
- `src/utils/logger.ts` – Client-side logging with configurable levels
- `src/utils/temperature.ts` – Temperature conversion utilities

**Config**:

- `src/config.ts` – Version and build-time configuration

### Backend Structure (`addon/rootfs/usr/src/app/src/`)

**Server & Middleware**:

- `src/server.ts` – Express app setup, WebSocket server, main entry point
- `src/middleware/` – Request logging, error handling, user context, ingress path stripping, request validation
- Middleware order is critical: ingress path stripping must happen before routing

**Service Layer**:

- `src/services/homeAssistantClient.ts` – Integration with Home Assistant API
- `src/services/valveManager.ts` & `src/core/valveManager.ts` – Manages valve state and availability
- `src/services/hruMonitor.ts` – Monitors HRU (heat recovery unit) status
- `src/services/timelineScheduler.ts` – Scheduling timeline events
- `src/services/mqttService.ts` – MQTT integration for device communication
- `src/services/database.ts` – SQLite database setup and migrations

**Features** (feature-based organization):

- `src/features/hru/` – HRU management (controller, repository, service, routes)
  - `hru.definitions.ts` – HRU unit definitions (Atrea, Korado, etc.)
  - `definitions/units/*.json` – Unit-specific configuration files
- `src/features/settings/` – Settings persistence (repository pattern)

**Routes** (Express routers):

- `src/features/hru/hru.routes.ts` – HRU endpoints
- `src/routes/timeline.ts` – Timeline event management
- `src/routes/settings.ts` – Settings API
- `src/routes/valves.ts` – Valve control
- `src/routes/status.ts` – System status
- `src/routes/database.ts` – Database operations

**Data Access**:

- `src/features/hru/hru.repository.ts` – HRU data access
- `src/features/settings/settings.repository.ts` – Settings persistence
- SQLite database with better-sqlite3

**Hardware Integration**:

- `src/shared/modbus/client.ts` – Modbus protocol for device communication
- `src/utils/hruWrite.ts` – HRU-specific write operations
- Mutex pattern for preventing concurrent operations

**Configuration & Types**:

- `src/config/options.ts` – Load configuration from environment
- `src/types/index.ts` – Shared TypeScript types
- `src/constants.ts` – App constants and version info
- `src/schemas/` – Zod schemas for API validation (hru.ts, timeline.ts, valves.ts, settings.ts, status.ts)

**Error Handling**:

- `src/shared/errors/apiErrors.ts` – Centralized error definitions
- Middleware error handler catches and formats errors consistently

### Home Assistant Integration

The backend acts as a Home Assistant add-on. Key integration points:

- Authenticates with Home Assistant via `HA_TOKEN`
- Syncs theme and language settings from Home Assistant
- Sends state updates to Home Assistant via service calls
- Uses Home Assistant's ingress feature (URL path-based routing)

## Code Patterns & Conventions

### Frontend

- **React 19**: Use `async` handlers with `useTransition` for mutations
- **Hooks**: Extract logic into custom hooks (see `src/features/timeline/hooks/`)
- **Component Pattern**: Functional components, TypeScript strict mode
- **Form Handling**: Mantine Form + Zod for validation
- **API Calls**: Use React Query for caching and synchronization
- **Logging**: Use `createLogger("ComponentName")` for debug visibility

### Backend

- **Function Declarations**: ESLint enforces `function` keyword over `const`/`let` (not arrow functions)
- **Quotes & Semicolons**: Double quotes, always semicolons
- **Repository Pattern**: Data access logic in `*.repository.ts`
- **Service Pattern**: Business logic in `*.service.ts`
- **Middleware Order**: Important – ingress path stripping must be first
- **Error Handling**: Use centralized error definitions from `apiErrors.ts`
- **Validation**: Use Zod schemas for all API inputs
- **Logging**: Use `createLogger("FeatureName")` from pino setup

### Database

- SQLite (better-sqlite3) for persistence
- Database setup in `src/services/database.ts`
- No ORM – direct SQL queries

## Build & Deployment

### Frontend Build Process

1. `tsc -b` – TypeScript type checking
2. `node scripts/copy-translations.mjs` – Copy backend locales to frontend
3. `vite build` – Bundle with chunking strategy (mantine, tanstack, motion, icons, date-fns as separate chunks)
4. Output goes to `dist/`

### Addon Build

1. `npm run build:addon` combines:
   - Frontend build (with type-checking)
   - Copy translations
   - `scripts/sync-dist.mjs` – Mirrors `dist/` into `addon/rootfs/usr/share/luftujha/www/`
2. For Home Assistant: Copy `addon/` folder into `/addons` share, rebuild via Supervisor UI

## Testing

- **Backend**: Vitest test files in `addon/rootfs/usr/src/app/tests/`
- Run with: `npm test` (from root or app directory)
- Test examples: hruService.test.ts, timelineRunner.test.ts, mutex.test.ts

## TypeScript Configuration

**Strict Mode** (tsconfig.app.json):

- `strict: true` – All strict checks enabled
- `noUnusedLocals: true` – Unused variables are errors
- `noUnusedParameters: true` – Unused parameters are errors
- `noFallthroughCasesInSwitch: true` – Switch must have breaks
- `noUncheckedSideEffectImports: true` – Mark side-effect imports explicitly

## ESLint Rules (eslint.config.js)

**All code**:

- Function declarations enforced (no arrow functions or const/let functions)
- Double quotes required
- Semicolons always required

**Backend override** (addon code):

- Uses Node.js globals (not browser)

**Frontend**:

- React hooks linting via eslint-plugin-react-hooks
- React Refresh rules for Vite HMR

## Environment Variables

### Frontend (browser, via VITE\_\* prefix)

- `VITE_API_BASE_URL` – Custom API endpoint (defaults to current origin)

### Backend (in `addon/rootfs/usr/src/app/.env`)

- `HA_BASE_URL` – Home Assistant URL (e.g., http://homeassistant.local:8123)
- `HA_TOKEN` – Long-lived access token from Home Assistant
- `PORT` – Backend port (default 8000)
- `LOG_LEVEL` – Logging level (debug, info, warn, error)

## Development Notes

- **Dev Server Proxying**: Frontend's Vite dev server (port 5173) proxies `/api` and `/ws` to backend (localhost:8000)
- **WebSocket**: Real-time updates pushed to connected clients via broadcast
- **Offline Valve Manager**: Backend supports offline mode without Home Assistant for testing
- **HRU Simulator**: See `tools/simulator/README.md` for testing HRU behavior
- **Translation Sync**: Backend has its own locale files; these are copied to frontend during build
- **Home Assistant Add-on**: Must run as container in Home Assistant with access to Modbus/MQTT

## Troubleshooting Common Issues

- **API 404**: Frontend is trying to call `/api` but backend isn't running. Start backend in `addon/rootfs/usr/src/app` with `npm run dev`
- **Type errors on build**: Run `tsc -b` to see full type-check output
- **WebSocket connection fails**: Check that backend is running and Vite dev server proxy is configured correctly
- **Translations missing**: Run `npm run build` (not just `npm run dev`) to copy backend locales to frontend
- **Linting fails with function declarations**: Use `function foo() {}` not `const foo = () => {}`
