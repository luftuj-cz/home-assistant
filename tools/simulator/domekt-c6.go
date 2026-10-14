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
// Supply and extract flow setpoints are 32-bit unsigned values in m3/h spread
// over two registers, high word first (106-107 supply, 108-109 extract). The
// controller rejects any read that covers only one half of such a pair.
//
// Register numbers in the manual are 1-based: register N lives at Modbus
// protocol address N-1 (ON/OFF, register 1, is address 0). The comments below
// use the manual numbering; the switch cases use protocol addresses.
//
// Register 5 is asymmetric: it reads back the full state enumeration 0..10 but
// only accepts writes of 1..4 (Away, Normal, Intensive, Boost).
type DomektC6 struct {
	on                 bool   // 1:   0 off, 1 on
	autoMode           bool   // 4:   0 off, 1 on
	mode               int    // 5:   0 Standby .. 10 Off, writable 1..4
	supplyFlow         uint32 // 106-107: m3/h
	extractFlow        uint32 // 108-109: m3/h
	setpoint           int    // 110: tenths of degC, range 50..400
	heating            bool   // 111: 0 off, 1 on
	supplyTemperature  int    // 902: tenths of degC
	extractTemperature int    // 903: tenths of degC
	filterImpurity     int    // 917: percent
}

func NewDomektC6() *DomektC6 {
	return &DomektC6{
		on:                 true,
		autoMode:           false,
		mode:               2, // Normal
		supplyFlow:         150,
		extractFlow:        150,
		setpoint:           200, // 20.0 degC
		heating:            false,
		supplyTemperature:  196,
		extractTemperature: 214,
		filterImpurity:     38,
	}
}

func boolRegister(value bool) uint16 {
	if value {
		return 1
	}
	return 0
}

func (d *DomektC6) read(register uint16) (uint16, *Exception) {
	switch register {
	case 0:
		return boolRegister(d.on), &Success
	case 3:
		return boolRegister(d.autoMode), &Success
	case 4:
		return uint16(d.mode), &Success
	case 105:
		return uint16(d.supplyFlow >> 16), &Success
	case 106:
		return uint16(d.supplyFlow & 0xFFFF), &Success
	case 107:
		return uint16(d.extractFlow >> 16), &Success
	case 108:
		return uint16(d.extractFlow & 0xFFFF), &Success
	case 109:
		return uint16(int16(d.setpoint)), &Success
	case 110:
		return boolRegister(d.heating), &Success
	case 901:
		return uint16(int16(d.supplyTemperature)), &Success
	case 902:
		return uint16(int16(d.extractTemperature)), &Success
	case 916:
		return uint16(d.filterImpurity), &Success
	}
	return 0, &IllegalDataAddress
}

func writeBool(name string, value uint16, target *bool) *Exception {
	if value > 1 {
		log.Printf("rejected %s %d, only 0 or 1 allowed\n", name, value)
		return &IllegalDataValue
	}
	*target = value == 1
	log.Printf(">>> CHANGE: %s=%t\n", name, *target)
	return &Success
}

func setHighWord(target *uint32, value uint16) {
	*target = uint32(value)<<16 | *target&0xFFFF
}

func setLowWord(target *uint32, value uint16) {
	*target = *target&0xFFFF0000 | uint32(value)
}

func (d *DomektC6) write(register uint16, value uint16) *Exception {
	switch register {
	case 0:
		return writeBool("on", value, &d.on)
	case 3:
		return writeBool("autoMode", value, &d.autoMode)
	case 4:
		// Read range is 0..10 but only Away..Boost may be written.
		if value < 1 || value > 4 {
			log.Printf("rejected mode %d, only 1..4 (Away, Normal, Intensive, Boost) are writable\n", value)
			return &IllegalDataValue
		}
		d.mode = int(value)
		log.Printf(">>> CHANGE: mode=%d\n", d.mode)
		return &Success
	case 105:
		setHighWord(&d.supplyFlow, value)
		return &Success
	case 106:
		setLowWord(&d.supplyFlow, value)
		log.Printf(">>> CHANGE: supplyFlow=%d m3/h\n", d.supplyFlow)
		return &Success
	case 107:
		setHighWord(&d.extractFlow, value)
		return &Success
	case 108:
		setLowWord(&d.extractFlow, value)
		log.Printf(">>> CHANGE: extractFlow=%d m3/h\n", d.extractFlow)
		return &Success
	case 109:
		if value < 50 || value > 400 {
			log.Printf("rejected setpoint %d, outside 50..400\n", value)
			return &IllegalDataValue
		}
		d.setpoint = int(value)
		log.Printf(">>> CHANGE: setpoint=%d\n", d.setpoint)
		return &Success
	case 110:
		return writeBool("heating", value, &d.heating)
	}
	return &IllegalDataAddress
}

// pairStarts holds the protocol addresses of the high words of 32-bit values.
var pairStarts = []uint16{105, 107}

// splitsPair reports whether a read of numRegs registers from register covers
// only one half of a 32-bit pair. The real C6 answers such a read with
// exception 3 (Illegal data value).
func splitsPair(register uint16, numRegs int) bool {
	end := int(register) + numRegs // exclusive
	for _, start := range pairStarts {
		hasHigh := int(start) >= int(register) && int(start) < end
		hasLow := int(start)+1 >= int(register) && int(start)+1 < end
		if hasHigh != hasLow {
			return true
		}
	}
	return false
}

func (d *DomektC6) Configure(serv *Server) {
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		// Like the real controller, refuse a read that splits a 32-bit pair.
		if splitsPair(register, numRegs) {
			log.Printf("rejected read %d+%d, splits a 32-bit register pair\n", register, numRegs)
			return []uint16{}, &IllegalDataValue
		}
		values := make([]uint16, numRegs)
		for i := range values {
			value, err := d.read(register + uint16(i))
			if err != &Success {
				return []uint16{}, err
			}
			values[i] = value
		}
		return values, &Success
	})

	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		return d.write(register, value)
	})

	// Function code 16 writes the same registers; the 32-bit flows use it.
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
