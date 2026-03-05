# LUFTaTOR Home Assistant Add-on

This add-on provides the backend service for LUFTaTOR smart home integration.

## Features

- **Local Control**: Runs entirely locally on your Home Assistant instance.
- **MQTT Integration**: Automatically discovers and communicates via the internal Home Assistant MQTT service.
- **Valve Control**: Manage your air exchange valves directly.
- **Timeline Scheduling**: Create and manage schedules for your HRU.

## Installation

1. Navigate to the Add-on Store in Home Assistant.
2. Add the LUFTaTOR repository. You can pick a branch to control which channel you install:
   - **Stable**: default branch (no suffix). Recommended for production.
   - **Development**: append `#development` when adding the repo URL (e.g., `https://github.com/luftuj-cz/home-assistant#development`) to try upcoming changes.
3. Install the "LUFTaTOR" add-on.
4. Start the add-on.

Repository naming tip: we use distinct display names per channel (e.g., "LUFTaTOR (Stable)" vs "LUFTaTOR (Development)") so you can differentiate installs inside Home Assistant.

## Configuration

The add-on works out of the box with the default configuration.

- **Log Level**: Adjust the verbosity of logs (default: `info`).
- **Web Port**: Port for the web interface (default: `8099`).
- **MQTT**: Automatically configured if the MQTT service is available. Manual configuration is also supported.
