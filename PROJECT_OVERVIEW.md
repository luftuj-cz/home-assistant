# LUFTaTOR Project Overview

## Company & Product

- **Luftuj** is the company delivering the solution.
- **LUFTaTORr** is the smart ventilation control system. It manages up to 12 motorized valves that regulate room recuperation based on demand.
- One Home Assistant instance running this add-on can orchestrate multiple Luftator controllers in parallel.

## High-level Flow

1. LUFTaTOR valves surface in Home Assistant as `number.luftator_*` entities.
2. The Home Assistant add-on (this repo) connects to HA via REST and WebSocket APIs to mirror and control those entities.
3. The React frontend serves an ingress UI for manual control and future dashboards.

## Repository Layout

- `src/` – React + TypeScript frontend (Vite, Mantine, TanStack Router, Bun toolchain).
  - `src/pages/DashboardPage.tsx` – landing page placeholder for aggregated insights.
  - `src/pages/ValvesPage.tsx` – manual control page for valve zones.
  - `src/components/` – shared UI components (e.g., `ValveCard`).
  - `src/layouts/AppLayout.tsx` – Mantine `AppShell` with navigation.
  - `src/router.tsx` – TanStack Router configuration.
- `addon/` – Home Assistant add-on bundle.
  - `addon/rootfs/usr/src/app/src/` – Bun + Express backend (`server.ts`) plus services like `homeAssistantClient.ts` and `core/valveManager.ts`.
    - `services/database.ts` – SQLite bootstrap + helpers via Bun's `bun:sqlite` API. Default DB lives at `/data/luftator.db` inside Supervisor; local dev falls back to `addon/rootfs/data/luftator.db` or `LUFTATOR_DB_PATH` env override.
  - `addon/config.yaml` & `build.yaml` – Supervisor metadata (note the product/company naming).
  - `addon/DOCS.md` – Add-on documentation (aligned with this overview).
- `docs/` – Modern documentation site using Fumadocs (Next.js).

## Frontend Stack Notes

- React 19, Mantine 7, TanStack Router 1.79.
- Global Mantine theme defined in `src/App.tsx`.
- Websocket + REST URLs are resolved from ingress origin with optional `VITE_API_BASE_URL` override for local dev.

## Backend Stack Notes

- Bun runtime inside the add-on container; `bun install` and `bun run dev` for local iterations.
- `HomeAssistantClient` authenticates using Supervisor/long-lived tokens and subscribes to Luftator state changes.
- `ValveManager` caches latest states, broadcasts snapshots/updates to frontend clients, proxies `number.set_value`, and persists snapshots/history via `services/database.ts`.
- `applyMigrations()` runs on startup: migrations are additive SQL snippets tracked in the `migrations` table (transactional, rollback-safe). Add new entries (e.g., `002_*`) to evolve schema and migrate data.

## Naming Guidance

- Use **Luftator** when referring to the control platform, valves, UI, or add-on.
- Use **LUFTaTOR** when referring to the company or the provider of the solution.
- Prefer “valves” or “zones” for individual control points.

## Common Tasks

- **Add UI features**: create pages under `src/pages/`, register routes in `src/router.tsx`, and surface navigation buttons in `AppLayout`.
- **Update valve handling**: adjust mapping logic in `src/pages/ValvesPage.tsx` and ensure backend expectations (`mapValve`, `ValveCard`) remain consistent.
- **Backend tweaks**: modify files under `addon/rootfs/usr/src/app/src/` and rebuild the add-on via `bun run build:addon`.

## Development Commands

````bash
bun install
dev frontend: bun run dev
lint: bun run lint
build frontend: bun run build
sync to add-on: bun run build:addon

## Future Enhancements (as of Oct 2025)
- Populate the dashboard with summaries (e.g., active zones, energy savings).
- Introduce automation scheduling or analytics in the backend.
- Harden error handling for Home Assistant connectivity (retry, token refresh UI).
- - **New**: Build SQLite-backed history/override views in the UI using the persisted data (available under `/data/luftator.db`).
2025-09 briefing)
- **Purpose**: Luftator snižuje náklady na větrání s rekuperací, vytápění a zvlhčování tím, že řídí až 12 párových přívodních/odvodních klapek na jedno zařízení (více jednotek lze řetězit pro rozsáhlejší objekty). Klapky jsou napojeny přímo na distribuční komoru a mohou pracovat v ucelených dvojicích (např. ložnice přívod + koupelna odvod).
- **Systémové komponenty** (pracovní seznam úkolů z dokumentu):
  - **Chytrá domácnost**: Home Assistant Green s MQTT brokerem a Zigbee klíčem (Home Assistant Connect ZBT). Úkol: ověřit, že všechny části níže komunikují s HA; po stabilizaci logiky domluvena integrace do knihoven Loxone.
  - **Rekuperační jednotky**: Preferovat modely s MODBUS rozhraním. Úkol: vybudovat katalog v GitHubu rozdělený na „ověřeno výrobcem“ a „bez záruky“ (jen MODBUS připojení), včetně popisu řízených funkcí (výkon, režim rekuperace/přetlaku/nočního předchlazení, teploty, čtení CO₂ apod.).
  - **Luftator hardware**: Vlastní modulární zařízení řídící klapky, boxy a hrdla včetně variant bez regulace, s manuální statickou regulací a s dynamickou servoregulací. Poznámka: Pro větší stavby lze kombinovat více jednotek.
- **Scénářové (časové) řízení** – základní, snadno pochopitelné pro klienty:
  - Scény otevírají konkrétní větve v definovaných časech (např. ložnice ve 22:00). Výkon rekuperační jednotky může být navázán na CO₂ hodnoty nebo pevné harmonogramy.
  - “Not Home” režim lze aktivovat geolokací (Wi-Fi přítomnost mobilů). Úkol: Zajistit konzistentní stavové pomocníky a bezpečné vypínání scén (pozor na chybné setrvačné stavy).
  - Aktuální repo obsahuje pouze demonstraci přepínání scén „všude“ vs. „pracovna“. Úkol: doplnit kompletní scénáře, ověřit logiku, dodat instalační protokol do GitHubu.
- **Dynamické multizonové řízení** – pokročilé, plně využívající čidla a priority:
  - **Prioritní vrstvy** (nejvyšší první): Manuální override → Krb → Boost → Not Home → CO₂ demand → Základní režim.
  - **Manuální zásah**: Klient může ručně nastavit klapky, výkon jednotky, požadovanou teplotu a dobu doběhu přímo v HA nebo na displeji zařízení. Úkol: Implementovat v HA konzistentní override (např. pomocí `input_boolean.manualni_override` + časovače) a umožnit snadné zrušení.
  - **Režim Not Home**: Pokud `group.mobilni_zarizeni` není doma déle než 5 min, otevřít všechny klapky a nastavit výkon na 12 %. Při návratu kohokoliv obnovit předchozí logiku. Musí být snadno deaktivovatelný (situace „odjeli všichni, přijede babička“).
  - **Boost tlačítka**: `button_koupelna`, `button_wc`, `button_kuchyne` vyvolají krátkodobé zvýšení výkonu a přesměrování vzduchu:
    - Výchozí stav: odvodní klapky otevřeny dle nižší priority, čekají na trigger.
    - Po stisku se zavřou ostatní odvodní větve a nastaví se výkon 50 % (koupelna, kuchyně) nebo 40 % (WC), případně sdílené hodnoty při souběhu: 70 % pro koupelna+kuchyně, 65 % při kombinaci s WC.
    - Doběhy: kuchyně 10 min, koupelna 8 min, WC 5 min (hodnoty klient může editovat). Po vypršení se vše vrací do uloženého stavu.
  - **Tlačítko Krb** (`button_krb`): Uzavře všechny odvodní klapky kromě kuchyně a přívodní kromě obývacího pokoje, nastaví výkon na 50 % a režim „Rozvážení motorů“ po dobu 5 min. Po doběhu vrátí stav.
  - **CO₂ demand control**:
    - Čidla: `sensor_CO2_loznice`, `sensor_CO2_op`, `sensor_CO2_dp`, `sensor_CO2_pracovna` (rozšířit dle potřeby).
    - Aktivace zóny: pokud CO₂ > 800 ppm po dobu 2 min, režim se přepne na CO₂, otevřou se klapky dané místnosti (přívod i odvod) a ostatní se zavřou. Výkon se plynule řídí tak, aby CO₂ nepřekročil 1000 ppm (vzorec viz níže), přičemž denní/noční limit výkonu se nastavuje dle plánovače (např. noc 22:00–6:00 max 60 %).
    - Deaktivace zóny: pokud CO₂ klesne pod 800 ppm na 5 min, klapka se zavře; pokud je poslední, přejde se do základního režimu (vše otevřeno, výkon 35 %).
    - Sezónní teploty: režim léto/zima lze řídit kalendářem nebo odečtem venkovní teploty přes MODBUS.
    - Doporučený výpočet výkonu (viz briefing):
      ```text
      výkon = 35 % + (input_number.co2_nejvyssi − 800) / (1000 − 800) × (Max_výkon − 35 %)
      ```
      kde `Max_výkon` je např. 100 % ve dne a 60 % v noci.
- **Implementační doporučení pro Home Assistant**:
  - Pomocníci: `input_select.vetrani_rezim`, `input_number.co2_nejvyssi`, `input_boolean.manualni_override`, `group.mobilni_zarizeni`, časovače pro boost/krb, persistentní úložiště pro obnovení stavů.
  - Automations/Templates: sledovat nejvyšší CO₂ hodnotu (template sensor), hysterézi 2 min/5 min, převzetí priority (přepínání `input_select` + ukládání/obnovení stavů).
  - Scripts / Node-RED: vhodné pro plynulý výpočet výkonu, řízení doby doběhu a synchronizaci párových klapek.
- **Otevřené úkoly**:
  - Zapsat scénářovou i dynamickou logiku do HA (Automations + Scripts/Node-RED) a sdílet jako open-source šablony.
  - Připravit instalační dokumenty v GitHubu (helpers, nastavení časů, bezpečné vypínání scén, override).
  - Ověřit kompatibilitu s reálnými jednotkami a periferiemi (recuperace, Nous) a průběžně aktualizovat katalog.

## Using This Document
Share this overview with new collaborators (including AI agents) to avoid repeating core context. Update it whenever product naming, architecture, or workflows shift.
````
