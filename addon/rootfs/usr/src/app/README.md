# LUFTaTOR Backend (Node + Express)

This directory contains the Home Assistant add-on backend implemented with Node (via tsx) and Express. It replaces the previous Python/FastAPI service.

## Scripts

- **Install dependencies**
  ```bash
  npm ci
  ```
- **Run in watch mode**
  ```bash
  npm run dev
  ```
- **Start once**
  ```bash
  npm run start
  ```
- **Run tests**
  ```bash
  npm test
  ```

## Environment

Configuration mirrors the old `options.json` fields:

- `LOG_LEVEL` – defaults to `info`
- `HA_BASE_URL` – defaults to `http://supervisor/core`
- `HA_TOKEN` or `SUPERVISOR_TOKEN` – mandatory outside Supervisor
- `STATIC_ROOT` – directory with the built frontend, default `/usr/share/luftujha/www`
- `CORS_ORIGINS` – comma-separated list. Defaults to `*` for development.

The runtime also reads `/data/options.json` inside Supervisor just like the legacy service.
