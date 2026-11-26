# Senzor projects for LUFTaTOR automatic control

Simulated CO2 sensors for developing automatic control (LUFTaTOR Algo CO2) against the development Home
Assistant. They are for development only: testers use their real sensors. Nobody on the team has access to
LUFTaQ sensors, so each simulated sensor is a faithful imitation of a real one instead.

**The imitated sensor:** a Tuya TS0601 air quality sensor (`_TZE200_yvx5lh6k`) paired with Zigbee2MQTT 2.14.3.
Zigbee2MQTT builds every byte from its source, so the topics, payloads (keys sorted, numbers as JavaScript prints
them), retain and QoS flags, the bridge's availability and the Home Assistant discovery configs are copied from
Zigbee2MQTT 2.14.3 and checked against real captures in its issue tracker
([#8154](https://github.com/Koenkk/zigbee2mqtt/issues/8154),
[#30112](https://github.com/Koenkk/zigbee2mqtt/issues/30112)). Home Assistant shows each one as a Tuya device
with CO2, temperature, humidity, VOC, formaldehyde and link quality (disabled by default), like the real thing.

Two things differ on purpose:

- **Base topic.** The projects use `zigbee2mqtt_senzor` and `zigbee2mqtt_senzor_b`, a setting Zigbee2MQTT
  allows. This keeps them clear of a real Zigbee2MQTT on the same broker.
- **Timing.** The real device sends one value per Zigbee frame every 1-3 s, and Zigbee2MQTT publishes the whole
  state each time. Here the whole state goes out every 2 s. The discovery configs repeat every 30 s, because
  Senzor sends a device's first message only after one interval.

[Senzor](https://github.com/kankaj/Senzor) publishes over MQTT to the broker of the development Home
Assistant. Open a file in the Senzor window (`senzor <file>`) or run it headless (`senzor-cli run <file>`).

| File           | What it simulates                                                                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rooms.toml`   | Four rooms with one sensor each (`Obyvak vzduch`, `Loznice vzduch`, …) behind one Zigbee2MQTT bridge. `Ramp vzduch` (off by default) climbs from 600 to 1300 ppm.                                                                                                                                 |
| `naughty.toml` | Failures of the same sensor behind a second bridge, one per device: eCO2 sitting at 360-380 ppm, a device out of range, a value that never changes, and the bridge going offline. The table at the top of the file says what LUFTaTOR should make of each. Put every sensor in a room of its own. |

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
- **A room that fills up:** `senzor-cli run tools/senzor/rooms.toml --only bridge,ramp,ramp_discovery`
  (add other device IDs as needed).
- **Zigbee2MQTT stops:** Kill `bridge_b` (or `bridge` in `rooms.toml`). The Last Will marks every sensor of that
  bridge `unavailable` at once.
- **A device out of range:** Stop `out_of_range` after it has reported. Zigbee2MQTT keeps device availability off
  by default, so Home Assistant keeps the last value. LUFTaTOR sets it aside once it has not changed for the
  age limit (2 h by default; lower it under Parametry to see it sooner).

## Cleaning up Home Assistant

The discovery configs are retained, so the devices stay in Home Assistant after Senzor stops. Stop the
devices, then run `senzor-cli clear-retained <file>`. Home Assistant removes each entity whose config is
cleared.
