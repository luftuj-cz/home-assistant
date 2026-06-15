# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## [1.0.9-stable] - 2026-06-15

### Added

- **Commissioning Feature**: Introduced a new commissioning tool with dedicated API and UI integration for easier
  initial setup and valve calibration.
- **MQTT Enhancements**: Shortened published MQTT entity names for better compatibility and readability in Home
  Assistant.
- **Timeline State Localization**: Added translations for timeline states and improved boost duration handling.

### Changed

- **Database Architecture**: Decomposed the monolithic database service into modular components (repositories and
  services) for better maintainability and reliability.
- **Timeline Scheduler**: Refactored the timeline scheduler and event picker to improve performance and event execution
  reliability.
- **Improved Validation**: Enhanced validation for HRU payloads and timeline events, including stricter temperature
  range limits and better error reporting.
- **Mobile UI Improvements**: Updated the Debug menu to use a dropdown selector on mobile devices for better space
  utilization.
- **Timeline Navigation**: Improved drag-scroll handling and layout responsiveness in the Timeline view.
- **HRU Write Operations**: Streamlined HRU write functionality with added request validation and enhanced error
  handling for Modbus communication.
- **Maintainability**: Integrated SonarQube for continuous code quality monitoring and applied various refactorings
  based on its recommendations.

### Fixed

- **Concurrency Issues**: Improved database initialization logic to prevent potential race conditions during concurrent
  access.
- **Temperature Handling**: Fixed validation schemas to correctly handle optional temperature values and provide clearer
  feedback.
- **Typo Fixes**: Corrected spelling of 'subtract' in internal function definitions and unit implementations.

## [1.0.8.2-stable] - 2026-05-21

### Fixed

- **HRU Data Type Conversions**: Added support for signed data types in HRU unit definitions.
- **HRU Register Value Handling**: Added signed/unsigned conversion support in unit definitions to correctly map
  register values.
- **Timeline Mode Copy Button**: Fixed copy button behavior in the mode valve selector.

## [1.0.8.1-stable] - 2026-05-13

### Added

- **Extended Xvent Parameters**: Added Xvent dashboard support for error state and remaining filter lifetime.

### Changed

- **Xvent Status Presentation**: Updated Xvent bypass and boost fields to use positive status flags for clearer
  dashboard visibility.
- **HRU Scripting Functions**: Added the `substract` operation so Xvent definitions can derive values such as remaining
  filter life from Modbus registers.
- **Xvent Simulator**: Expanded the Xvent simulator with filter lifetime, elapsed runtime, and error register support
  for development and testing.

## [1.0.8-stable] - 2026-05-13

### Added

- **Debug Page Tools**: Added buttons to refresh MQTT discovery, restart the timeline scheduler, and stop active
  timeline overrides.
- **Improved UI Feedback**: Replaced notifications with badges for HRU and MQTT connection tests in Settings for better
  visual consistency.
- **Zehnder Support**: Added support for Zehnder HRU units, including simulator coverage for development and testing.

### Changed

- **Timeline Operations**: Multiple notifications during day copy-paste operations are now replaced by a single summary
  notification.
- **Frontend Architecture**: Reorganized the frontend into feature-based modules and shared UI building blocks for
  better maintainability.
- **Data Fetching**: Migrated more frontend data loading to TanStack Query and lazy-loaded routes to improve
  synchronization and responsiveness.
- **Valve Controls**: Updated slider behavior to better match real Luftator valve values.

### Fixed

- **Code Quality**: Refactored internal error handling patterns and fixed various linting/formatting issues.
- **Backend Tests**: Restored broken backend tests for HRU and Timeline services.
- **Valve Entity Filtering**: Adjusted frontend filtering so valid valve entities are shown correctly.
- **Zehnder Integration**: Fixed follow-up issues in Zehnder definitions and translations after the initial integration.
- **Onboarding and Mobile UI**: Fixed several onboarding flow issues and polished mobile navigation behavior.

## [1.0.7-stable] - 2026-04-22

### Added

- **New Debug Page**: Added a specialized debug page for easier troubleshooting and system status monitoring.
- **Improved Error Handling**: API errors in notifications are now translated and more user-friendly instead of raw JSON
  strings.
- **Flexible Onboarding**: Users can now skip the onboarding process and import an existing database directly.
- **AI Guidance**: Added `CLAUDE.md` to provide better context and guidance for AI assistants working with the codebase.

### Changed

- **Unified Toolchain**: Migrated to **Vite+** (including Rolldown, Oxlint, and Oxfmt) for significantly faster builds
  and unified code quality checks.
- **Mantine v9 Upgrade**: Upgraded the component library to Mantine v9 with major UX improvements across valves,
  settings, timeline, and navigation.
- **Performance Optimization**: Replaced `framer-motion` with native CSS animations, reducing the overall bundle size.
- **Dependencies Clean-up**: Removed Prettier and ESLint in favor of the faster Vite+ toolchain (Oxlint/Oxfmt).
- **Frontend Logging**: Refined and improved the client-side logging system for better development and debugging
  experience.

### Fixed

- **Add-on Builder**: Updated deprecated Home Assistant builder image to ensure stable builds.
- **Onboarding Flow**: Fixed an issue where MQTT settings couldn't be configured before skipping onboarding.
- **UI Polishing**: Numerous small fixes for layout and styling after the Mantine v9 migration.

## [1.0.6-stable] - 2026-03-21

### Added

- Offline mode notice — users are now informed when valve values may not be up to date due to offline mode.
- New and improved addon logo for Home Assistant.
- New README and Czech README (README.cs.md).

### Fixed

- Fixed drag and scroll in Timeline on mobile devices.
- Fixed mode creation modal layout and controls for mobile.
- Fixed form validation error placement in mode creation.
- Fixed copy-paste in timeline — day is now correctly cleared before paste.
- Prevented creating or copying two timeline events with the same time.

## [1.0.5-stable] - 2026-03-16

### Changed

- Refined the dashboard HRU status card and the settings page layout, including the HRU test button UI.
- Updated the Korado Ventbox simulator and Korado unit definitions.

### Fixed

- Improved reliability when loading values from the HRU to avoid intermittent read errors.
- Fixed manual mode run-on time being displayed among valves.
- Corrected temperature scaling for Korado units.

## [1.0.4-stable] - 2026-03-05

### Changed

- Migrated frontend/backend runtime from Bun to NodeJS for better compatibility with the other HW. (Now works on
  Raspberry Pi)

### Fixed

- Fixed addon startup failure in Home Assistant by updating tsx loader flag from deprecated `--loader` to `--import`.

### Thanks

- Thanks to [@JanNohejl](https://github.com/JanNohejl) for
  reporting [issue #4](https://github.com/luftuj-cz/home-assistant/issues/4).

## [1.0.3-stable] - 2026-03-02

### Fixed

- Prevented demo HRU keep-alive loop from crashing when no integration keepAlive is defined.

## [1.0.2-stable] - 2026-03-02

### Fixed

- Valve filtering was too strict for certain luftator valve IDs.

## [1.0.1-stable] - 2026-03-01

### Fixed

- Quickfix: manual mode entity was showing up as a valve; filtered out.

## [1.0.0-stable] - 2026-03-01

### Added

- First stable version of this addon
- If you find a bug or want to add a new HRU, open an issue: https://github.com/luftuj-cz/home-assistant/issues/new
