# Senzor projects for LUFTaTOR automatic control

Simulated CO2 sensors for developing automatic control (LUFTaTOR Algo CO2) against the development Home
Assistant. They are for development only: testers use their real sensors. Nobody on the team has access to
LUFTaQ sensors, so these stand in for "some CO2 sensor in Home Assistant".

[Senzor](https://github.com/kankaj/Senzor) publishes over MQTT to the broker of the development Home
Assistant, and Home Assistant creates the entities through MQTT Discovery. Open a file in the Senzor window
(`senzor <file>`) or run it headless (`senzor-cli run <file>`).

| File           | What it simulates                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rooms.toml`   | One air sensor per room: a device with CO2, temperature and humidity. `sim_ramp` (off by default) climbs from 600 to 1300 ppm.                                                                                                                                                  |
| `shapes.toml`  | Shapes Senzor's discovery does not produce: one entity with the values in attributes (`sim_vzduch_attr`), and a CO2 entity with `device_class: carbon_dioxide` (`sim_co2_trida`).                                                                                               |
| `naughty.toml` | One misbehaving sensor per reading rule: no availability, the same value every time, 0 and 65535 after a "restart", a wrong unit, text instead of a number, a slow reporter, and a Last Will drop-out. The table at the top of the file says what LUFTaTOR should make of each. |

## Setup

1. In Home Assistant, create a user `senzor` (Settings → People → Users). The Mosquitto add-on accepts Home
   Assistant users.
2. Put its password in `SENZOR_MQTT_PASSWORD`. Senzor reads it when it loads a project. `senzor-cli
   validate` needs the variable to be set too, though any value will do there.
3. Check a file without connecting: `SENZOR_MQTT_PASSWORD=x senzor-cli validate tools/senzor/rooms.toml`.

The broker is `homeassistant.local:1883` in every file. Change `[broker]` (or the broker settings in the
window) for another one.

## Driving a test

- **Push a room over a threshold:** in the window, pin `co2` of a device (for example 1300 ppm for TH2).
  Unpin it to let it wander again.
- **A room that fills up:** `senzor-cli run tools/senzor/rooms.toml --only sim_ramp` (combine with other
  IDs).
- **A sensor that disappears:** Kill `sim_vypadek` (Last Will → `unavailable` at once). Stop
  `sim_bez_dostupnosti`: Home Assistant keeps its last value and only the age limit catches it.

## Cleaning up Home Assistant

The discovery configs are retained, so the devices stay in Home Assistant after Senzor stops. Stop the
devices, then run `senzor-cli clear-retained <file>`. Home Assistant removes each entity whose config is
cleared.
