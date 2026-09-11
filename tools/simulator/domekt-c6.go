package main

import (
	"log"

	. "github.com/tbrandon/mbserver"
)

// DomektC6 simulates a Komfovent Domekt unit with a C6 / C6M controller.
//
// The controller exposes everything through holding registers and supports only
// function codes 03, 06 and 16 (Table 1 of the manual) - there are no input
// registers, coils or discrete inputs.
//
// Register 5 is asymmetric: it reads back the full state enumeration 0..10 but
// only accepts writes of 1..4 (Away, Normal, Intensive, Boost).
type DomektC6 struct {
	mode                    int // 5:   0 Standby .. 10 Off, writable 1..4
	setpointNormal          int // 110: tenths of degC, range 50..400
	supplyTemperature       int // 902: tenths of degC
	extractTemperature      int // 903: tenths of degC
	outdoorTemperature      int // 904: tenths of degC
	fanIntensivity          int // 910: tenths of a percent, range 0..1000
	filterImpurity          int // 917: percent
	heatExchangerEfficiency int // 924: percent
	alarm                   bool
}

func NewDomektC6() *DomektC6 {
	return &DomektC6{
		mode:                    2,   // Normal
		setpointNormal:          200, // 20.0 degC
		supplyTemperature:       196,
		extractTemperature:      214,
		outdoorTemperature:      -73, // -7.3 degC
		fanIntensivity:          520, // 52.0 %
		filterImpurity:          38,
		heatExchangerEfficiency: 84,
		alarm:                   false,
	}
}

func (d *DomektC6) read(register uint16) (uint16, *Exception) {
	switch register {
	case 5:
		return uint16(d.mode), &Success
	case 110:
		return uint16(int16(d.setpointNormal)), &Success
	case 902:
		return uint16(int16(d.supplyTemperature)), &Success
	case 903:
		return uint16(int16(d.extractTemperature)), &Success
	case 904:
		return uint16(int16(d.outdoorTemperature)), &Success
	case 910:
		return uint16(d.fanIntensivity), &Success
	case 917:
		return uint16(d.filterImpurity), &Success
	case 924:
		return uint16(d.heatExchangerEfficiency), &Success
	case 958:
		if d.alarm {
			return 1, &Success
		}
		return 0, &Success
	}
	return 0, &IllegalDataAddress
}

func (d *DomektC6) write(register uint16, value uint16) *Exception {
	switch register {
	case 5:
		// Read range is 0..10 but only Away..Boost may be written.
		if value < 1 || value > 4 {
			log.Printf("rejected mode %d, only 1..4 (Away, Normal, Intensive, Boost) are writable\n", value)
			return &IllegalDataValue
		}
		d.mode = int(value)
		log.Printf(">>> CHANGE: mode=%d\n", d.mode)
		return &Success
	case 110:
		if value < 50 || value > 400 {
			log.Printf("rejected setpoint %d, outside 50..400\n", value)
			return &IllegalDataValue
		}
		d.setpointNormal = int(value)
		log.Printf(">>> CHANGE: setpointNormal=%d\n", d.setpointNormal)
		return &Success
	}
	return &IllegalDataAddress
}

func (d *DomektC6) Configure(serv *Server) {
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataValue
		}
		value, err := d.read(register)
		if err != &Success {
			return []uint16{}, err
		}
		return []uint16{value}, &Success
	})

	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		return d.write(register, value)
	})

	// Function code 16 is listed as supported, so it writes the same registers.
	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		for i, value := range values {
			if err := d.write(register+uint16(i), value); err != &Success {
				return err
			}
		}
		return &Success
	})

	// The C6 controller supports only function codes 03, 06 and 16.
	OnWriteCoil(serv, func(address uint16, value bool) *Exception {
		return &IllegalFunction
	})
	OnReadCoils(serv, func(address uint16, numCoils int) ([]bool, *Exception) {
		return []bool{}, &IllegalFunction
	})
	OnReadDiscreteInputs(serv, func(address uint16, numInputs int) ([]bool, *Exception) {
		return []bool{}, &IllegalFunction
	})
	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		return []uint16{}, &IllegalFunction
	})
}
