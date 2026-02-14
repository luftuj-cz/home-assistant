# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.8-dev] - 2026-02-14

### Added

- Automatic MQTT service discovery using Home Assistant's internal service.
- Standard Dockerfile labels for better Supervisor integration.
- `README.md` and `CHANGELOG.md` for better documentation.

### Changed

- Refactored `run` script to inject environment variables for service credentials.
- Updated `config.yaml` to use `homeassistant_config` mapping instead of legacy `config`.
