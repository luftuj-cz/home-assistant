# Atrea RD5 Home Assistant Integration

This document consolidates the configuration, automations, and scripts required to control an Atrea RD5 unit via Modbus in Home Assistant.

## 1. configuration.yaml

_Main configuration defining Modbus connection, sensors, and input helpers._

```yaml
# Note: Ensure you replace IP_ADDRESS with your unit's actual IP.
# If merging into a single file, remove the !include lines and paste the respective files below.

automation hru: !include automations-atrea-rd5.yaml
script hru: !include scripts-atrea-rd5.yaml

modbus:
  - name: hru_atrea_rd5
    type: tcp
    host: IP_ADDRESS
    port: 502
    sensors:
      - name: hru_requested_power_value
        unique_id: hru_requested_power_value
        slave: 1
        input_type: holding
        address: 10704
        unit_of_measurement: '%'
        device_class: power_factor
        scan_interval: 10
      - name: hru_requested_temperature_value
        unique_id: hru_requested_temperature_value
        slave: 1
        scale: 0.1
        precision: 1
        input_type: holding
        address: 10706
        unit_of_measurement: '°C'
        device_class: temperature
        scan_interval: 10
      - name: hru_mode_value
        unique_id: hru_mode_value
        slave: 1
        input_type: holding
        address: 10705
        scan_interval: 10

input_number:
  hru_requested_power:
    name: "Rekuperace: požadovaný výkon"
    min: 12
    max: 100
    initial: 40
    step: 2
    unit_of_measurement: "%"
    mode: slider
    icon: "mdi:fan"
  hru_requested_temperature:
    name: "Rekuperace: požadovaná teplota"
    min: 10
    max: 40
    initial: 22.5
    step: 0.5
    unit_of_measurement: "°C"
    mode: slider
    icon: "mdi:thermometer"

input_select:
  hru_mode:
    name: "Rekuperace: režim"
    options:
      - "Vypnuto"
      - "Automat"
      - "Větrání"
      - "Cirkulace s větráním"
      - "Cirkulace"
      - "Noční předchlazení"
      - "Rozvážení"
      - "Přetlak"
    initial: "Větrání"
2. automations-atrea-rd5.yaml
Logic to synchronize UI inputs (sliders/dropdowns) with the physical unit and vice-versa.

YAML

- id: hru_requested_power_change
  alias: "Nastavit požadovaný výkon rekuperace při změně"
  trigger:
    - platform: state
      entity_id: input_number.hru_requested_power
  condition:
    - condition: template
      value_template: "{{ (trigger.to_state.state | int(0)) >= 12 }}"
  action:
    - service: script.hru_set_requested_power
      data:
        value: "{{ trigger.to_state.state | int(0) }}"
- id: hru_requested_temperature_change
  alias: "Nastavit požadovanou teplotu rekuperace při změně"
  trigger:
    - platform: state
      entity_id: input_number.hru_requested_temperature
  condition:
    - condition: template
      value_template: "{{ (trigger.to_state.state | float(0)) >= 10 }}"
  action:
    - service: script.hru_set_requested_temperature
      data:
        value: "{{ trigger.to_state.state | float(0) }}"
- id: hru_mode_change
  alias: "Nastavit režim rekuperace při změně"
  trigger:
    - platform: state
      entity_id: input_select.hru_mode
  action:
    - service: script.hru_set_mode
      data:
        value: "{{ trigger.to_state.state }}"
- id: hru_requested_temperature_load
  alias: "Načíst požadovanou teplotu rekuperace"
  trigger:
    - platform: state
      entity_id: sensor.hru_requested_temperature_value
  action:
    - service: input_number.set_value
      target:
        entity_id: input_number.hru_requested_temperature
      data:
        value: "{{ trigger.to_state.state | float(0) }}"
- id: hru_requested_power_load
  alias: "Načíst požadovaný výkon rekuperace"
  trigger:
    - platform: state
      entity_id: sensor.hru_requested_power_value
  action:
    - service: input_number.set_value
      target:
        entity_id: input_number.hru_requested_power
      data:
        value: "{{ trigger.to_state.state | int(0) }}"
- id: hru_mode_load
  alias: "Načíst režim rekuperace"
  trigger:
    - platform: state
      entity_id: sensor.hru_mode_value
  action:
    - service: input_select.select_option
      target:
        entity_id: input_select.hru_mode
      data:
        option: "{{ state_attr('input_select.hru_mode', 'options')[ trigger.to_state.state | int(0) ]}}"
3. scripts-atrea-rd5.yaml
Sequences that handle the Modbus write operations.

YAML

hru_set_requested_power:
  description: "Rekuperace: nastav požadovaný výkon"
  fields:
    value:
      description: "Požadovaný výkon v procentech"
      example: 50
  sequence:
    - service: modbus.write_register
      data_template:
        hub: hru_atrea_rd5
        unit: 1
        address: 10700
        value: 0
    - delay:
        milliseconds: 100
    - service: modbus.write_register
      data_template:
        hub: hru_atrea_rd5
        unit: 1
        address: 10708
        value: "{{ value }}"
hru_set_requested_temperature:
  description: "Rekuperace: nastav požadovanou teplotu"
  fields:
    value:
      description: "Požadovaná teplota v stupních Celsia"
      example: 50
  sequence:
    - service: modbus.write_register
      data_template:
        hub: hru_atrea_rd5
        unit: 1
        address: 10702
        value: 0
    - delay:
        milliseconds: 100
    - service: modbus.write_register
      data_template:
        hub: hru_atrea_rd5
        unit: 1
        address: 10710
        value: "{{ (value * 10) | round(0) | int }}"
hru_set_mode:
  description: "Rekuperace: nastav režim"
  fields:
    value:
      description: "Požadovaný režim"
      example: "Větrání"
  sequence:
    - service: modbus.write_register
      data_template:
        hub: hru_atrea_rd5
        unit: 1
        address: 10701
        value: 0
    - delay:
        milliseconds: 100
    - service: modbus.write_register
      data_template:
        hub: hru_atrea_rd5
        unit: 1
        address: 10709
        value: "{{ state_attr('input_select.hru_mode', 'options').index(value) | int(0) }}"
4. Context (README.md)
Original documentation regarding unit setup.

Rekuperační jednotky Atrea s řízením RD5
Konfigurace automatizace
Home Assistant

Konfigurace jednotky
Do webového prohlížeče zadejte IP adresu vaší jednotky Atrea a přihlašte se (výchozí heslo: pass)

V pravém dolním rohu klikněte na odkaz Servisní nastavení

Na kartě 3. Nastavení zvolte podmenu 3.15. Správa a přepněte parametry 3.15.1 Modbus TCP na Ano (pokud nemáte přístup do servisního nastavení, kontaktujte autorizovaného servisního technika)

Postupujte podle instrukcí dle zvolené automatizační platformy (viz výše)
```
