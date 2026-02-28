# Development Guidelines

This document provides essential information for advanced developers working on the LUFTaTOR Home Assistant project.

## 0. Project Structure

- `src/`: Frontend React application (Vite, Mantine).
- `addon/`: Home Assistant add-on configuration and backend.
  - `addon/rootfs/usr/src/app/`: Backend Express application (Bun, TypeScript).
- `scripts/`: Utility scripts for synchronization and versioning.
- `docs/`: Documentation (Docusaurus/similar).

## 1. Build and Configuration

### Prerequisites
- **Bun (1.1.26+)**: This project uses [Bun](https://bun.sh/) for package management, running scripts, and the backend runtime.
- **Home Assistant**: Specifically designed to be run as a Home Assistant Add-on.

### Frontend Development
The frontend is a React + Vite application located in the root directory.
- **Installation**: `bun install`
- **Development**: `bun run dev` (Starts Vite dev server on http://localhost:5173).
- **Production Build**: `bun run build`
- **Add-on Sync**: `bun run build:addon` (Builds the frontend and syncs assets to the add-on filesystem in `addon/rootfs/usr/share/luftujha/www/`).

### Backend Development
The backend is a Bun-powered Express application located in `addon/rootfs/usr/src/app`.
- **Installation**: `cd addon/rootfs/usr/src/app && bun install`
- **Development**: `bun run dev` (Starts backend with watch mode).
- **Production**: `bun start`
- **Configuration**: Managed via `options.json` (mapped to `src/config/options.ts`) in the add-on environment.

### Proxy Configuration
The Vite dev server is configured to proxy `/api` and `/ws` requests to `http://localhost:8000` (the default backend port for local development).

### Versioning
Use the provided script to update versions across all components (root `package.json`, frontend `config.ts`, backend `constants.ts`, and add-on `config.yaml`):
```bash
bun scripts/set-version.mjs <new-version>
```

## 2. Testing

### Test Runner
We use **Bun's built-in test runner** (`bun test`).

### Running Tests
- **All tests**: `bun test` (from root runs both frontend and backend tests).
- **Frontend specific**: `bun run test` (mapped to `bun test` in root `package.json`).
- **Backend specific**: `cd addon/rootfs/usr/src/app && bun test`.

### Adding New Tests
- Create a file with the suffix `.test.ts` (e.g., `src/utils/myUtils.test.ts`).
- Use `import { expect, test, describe } from "bun:test";`.
- Run `bun test <path-to-file>` to execute it.

**Example Test:**
```typescript
import { expect, test, describe } from "bun:test";
import { formatTemperature } from "./temperature";

describe("temperature utils", () => {
  test("formatTemperature should convert Celsius to Fahrenheit", () => {
    expect(formatTemperature(0, "f")).toBe(32);
    expect(formatTemperature(100, "f")).toBe(212);
  });
});
```

## 3. Additional Development Information

### Code Style
- **TypeScript**: Strictly used for both frontend and backend.
- **Linting**: ESLint is configured at the root (`eslint.config.js`). Run `bun run lint`.
- **Formatting**: Prettier is used. Run `bun run format`.
- **UI Components**: Built using [Mantine](https://mantine.dev/).
- **Icons**: [Tabler Icons React](https://tabler-icons.io/react).

### Home Assistant Integration
- **Ingress**: The add-on uses an Ingress path. The backend includes middleware (`ingressPath.ts`) to handle stripping the ingress prefix.
- **Relative Paths**: The frontend uses `base: "./"` in Vite config to ensure relative paths work correctly under Ingress.
- **Synchronization**: Always run `bun run build:addon` before packaging or testing the add-on in Home Assistant to ensure the latest frontend assets are included in the Docker image.

### Documentation
Documentation is stored in the `docs` directory and uses `npm`:
- `bun run docs:dev`
- `bun run docs:build`
