# Luftator Home Assistant Add-on

The Luftator add-on, built by **Luftuj**, provides a real-time dashboard for valves exposed as `number.luftator_*` entities in Home Assistant. A single Home Assistant environment can control multiple Luftator hardware controllers at once. The add-on discovers all matching entities, mirrors their state using the Supervisor WebSocket API, and offers control sliders with advanced automation through a built-in Timeline Scheduler.

## Features

- **Automated Discovery**: Finds every `number.luftator_*` entity automatically.
- **Live Sync**: Streams live updates via Home Assistant WebSocket API.
- **Timeline Scheduler**: Creates complex daily/weekly schedules for valves and HRU units.
- **HRU Integration**: Native support for Heat Recovery Units (Atrea, etc.) via Modbus TCP.
- **MQTT Integration**: Exposes sensors and control buttons (Boost) to Home Assistant.
- **Ingress Dashboard**: A custom MUI dashboard for easy monitoring and configuration.

## Configuration

The add-on exposes the following options:

- `log_level` (`trace`, `debug`, `info`, `notice`, `warning`, `error`, `fatal`) – defaults to `info`.
- `web_port` (1024-65535) - Internal port for the web server, defaults to 8099.

### MQTT Configuration (Optional)

To enable HRU sensor integration and Boost control in Home Assistant:

- `mqtt_host`: Hostname or IP of the MQTT broker. Leave empty to disable MQTT.
- `mqtt_port`: MQTT broker port (default `1883`).
- `mqtt_user`: MQTT username (optional).
- `mqtt_password`: MQTT password (optional).

When configured, the add-on will publish:

- **Sensors**: Power (%), Temperature (°C), Mode, and Boost Time Remaining.
- **Controls**: Boost Start and Cancel buttons (with configurable duration).

## Installation

1. Copy the `addon/` directory into your Home Assistant add-ons folder (e.g., `/addons/luftujha`).
2. From the Home Assistant UI, navigate to **Settings → Add-ons → Add-on Store** and use the three-dot menu to **Repositories**, then add the repository containing this add-on.
3. Locate "Luftujha" in the store, install it, and enable Ingress.
4. Start the add-on.

## Usage

### Dashboard

Open the add-on via Ingress. The dashboard displays valve cards with real-time sliders. Adjustments are proxied immediately to Home Assistant.

### Timeline

The **Timeline** page allows you to define "Modes" (preset combinations of power, temperature, and HRU mode) and schedule them across a 7-day week. The scheduler ensures that your home environment adjusts automatically throughout the day.

### HRU Settings

In **Settings → HRU Settings**, you can configure your hardware unit (e.g., Atrea RD5). Once configured, the add-on maintains a Modbus TCP connection to poll status and apply scheduled changes.

### Database Tools

In **Settings → Database tools**, you can export or import the SQLite database (`luftator.db`). Imports automatically create a backup of the existing data before applying the new file.

## Development Notes

- Backend: `addon/rootfs/usr/src/app/src/` (Bun + Express + Pino)
- Frontend: `src/` (React + Vite + MUI)
- Storage: SQLite (`bun:sqlite`), defaults to `/data/luftator.db`.

### Local Development

1. **Backend**:
   ```bash
   cd addon/rootfs/usr/src/app
   bun install
   bun run dev
   ```
2. **Frontend**:

   ```bash
   npm install
   VITE_API_BASE_URL=http://localhost:8000/ npm run dev
   ```

3. **Production Build**:
   The React app is built and served from `/usr/share/luftujha/www` inside the add-on container.
