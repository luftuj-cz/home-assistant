# LUFTaTOR Home Assistant Frontend

React + TypeScript UI delivered by **LUFTaTOR** for managing **Luftator** ventilation valves. One Home Assistant instance can supervise multiple Luftator controllers through this add-on. The application is built with Vite and Mantine, and is now completely driven by **Bun** for dependency management and scripts.

## Prerequisites

- [Bun 1.1.26+](https://bun.sh/) (installs dependencies and runs scripts)
- Node.js is no longer required for the frontend workflow

## Quick start

```bash
bun install          # install dependencies and create bun.lockb
bun run dev          # start Vite dev server on http://localhost:5173
```

## Scripts

- `bun run dev` – start the Vite dev server with HMR.
- `bun run build` – type-check (`tsc -b`) and build production assets.
- `bun run lint` – run ESLint across the project.
- `bun run preview` – preview the production build locally.
- `bun run build:addon` – run the production build and sync the output into `addon/rootfs/usr/share/luftujha/www/` for the Home Assistant add-on package.

## Syncing assets to the add-on

`bun run build:addon` invokes `scripts/sync-dist.mjs` via Bun to mirror `dist/` into the add-on rootfs. The script will fail if you forget to run `bun run build` first, so this command combines both steps automatically.

## Home Assistant notes

- The add-on backend (stored under `addon/rootfs/usr/src/app/`) already runs on Bun inside the Supervisor container.
- When testing locally, run the backend with `bun run dev` inside that directory and point the frontend to the exposed API using `VITE_API_BASE_URL`.
- For Home Assistant packaging, run `bun run build:addon`, copy the `addon/` folder into your `/addons` share, and rebuild the add-on via the Supervisor UI.

## Linting & formatting

ESLint configuration lives in `eslint.config.js`. Run `bun run lint` to ensure the codebase passes all checks before syncing to the add-on.

## Troubleshooting

- Missing styles? Ensure `src/main.tsx` imports `@mantine/core/styles.css` and rebuild.
- If you see stale assets in Home Assistant, re-run `bun run build:addon` and rebuild the add-on image.
