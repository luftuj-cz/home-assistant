# LUFTaTOR Home Assistant Frontend

[![English](https://img.shields.io/badge/lang-en-blue)](README.md) [![Čeština](https://img.shields.io/badge/lang-cs-red)](README.cs.md)

React + TypeScript UI delivered by **LUFTaTOR** for managing **Luftator** ventilation valves. One Home Assistant instance can supervise multiple Luftator controllers through this add-on. The application is built with Vite and Mantine and is driven by **npm + Node.js** for both the frontend and add-on backend.

## Prerequisites

- [Node.js 20+](https://nodejs.org/) (installs dependencies and runs scripts)
- npm (ships with Node.js)

## Quick start

```bash
npm install          # install dependencies and create package-lock.json
npm run dev          # start Vite dev server on http://localhost:5173
# in addon/rootfs/usr/src/app/ (backend)
npm run dev          # start backend dev server
```

Create a local `.env` in `addon/rootfs/usr/src/app/` (backend) with:

```
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=<HA_TOKEN>
PORT=8000
```

HA_TOKEN documentation: https://developers.home-assistant.io/docs/auth_api/#long-lived-access-token

## Scripts

- `npm run dev` – start the Vite dev server with HMR.
- `npm run build` – type-check (`tsc -b`) and build production assets.
- `npm run lint` – run ESLint across the project.
- `npm run preview` – preview the production build locally.
- `npm run build:addon` – run the production build and sync the output into `addon/rootfs/usr/share/luftujha/www/` for the Home Assistant add-on package.

## Versioning the add-on

Use `scripts/set-version.mjs` from the repo root to bump versions consistently across frontend and add-on:

```bash
# stable (adds -stable suffix if missing)
node scripts/set-version.mjs --stable 1.2.3

# development (adds -dev suffix if missing)
node scripts/set-version.mjs --dev 1.2.3
```

This script updates `package.json`, `src/config.ts`, `addon/config.yaml`, and `addon/rootfs/usr/src/app/src/constants.ts`.

## Syncing assets to the add-on

`npm run build:addon` invokes `scripts/sync-dist.mjs` via Node to mirror `dist/` into the add-on rootfs. The script will fail if you forget to run `npm run build` first, so this command combines both steps automatically.

## Home Assistant notes

- The add-on backend (stored under `addon/rootfs/usr/src/app/`) runs on Node.js.
- When testing locally, run the backend with `npm run dev` inside that directory and point the frontend to the exposed API using `VITE_API_BASE_URL`.
- For Home Assistant packaging, run `npm run build:addon`, copy the `addon/` folder into your `/addons` share, and rebuild the add-on via the Supervisor UI.

## Tools

- HRU simulator: see [`tools/simulator/README.md`](tools/simulator/README.md).

## Linting & formatting

ESLint configuration lives in `eslint.config.js`. Run `npm run lint` to ensure the codebase passes all checks before syncing to the add-on.
