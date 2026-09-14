package main

import (
	"log"

	. "github.com/tbrandon/mbserver"
)

// Brink simulates a Brink HRA with a UWA2-B / UWA2-E Modbus board.
//
// Address blocks, as the board lays them out:
//   - 4xxx  input registers  (FC4) - read-only measured values
//   - 6xxx  holding registers (FC3/FC6) - stored parameters, readable and writable
//   - 8xxx  holding registers (FC3/FC6) - control handshake
//
// Control handshake: holding register 8000 selects the control source
// (0 = off, 1 = switch position, 2 = flow rate). A write to 8002 is only
// accepted while 8000 holds the value 2.
type Brink struct {
	controlMode        int // 8000: 0 off, 1 switch position, 2 flow rate
	flowSetpoint       int // 8002: desired flow rate in m3/h
	bypassMode         int // 6100: 0 auto, 1 forced closed, 2 forced open
	flowIn             int // 4032: current supply air flow in m3/h
	supplyTemperature  int // 4036: tenths of degC, air blown into the house
	exhaustTemperature int // 4046: tenths of degC, air blown outdoors
	filterDirty        bool
}

func NewBrink() *Brink {
	return &Brink{
		controlMode:        0,
		flowSetpoint:       150,
		bypassMode:         0, // Auto, the documented default
		flowIn:             148,
		supplyTemperature:  195, // 19.5 degC
		exhaustTemperature: 68,  // 6.8 degC
		filterDirty:        false,
	}
}

func (b *Brink) Configure(serv *Server) {
	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataValue
		}
		switch register {
		case 4032:
			return []uint16{uint16(b.flowIn)}, &Success
		case 4036:
			return []uint16{uint16(int16(b.supplyTemperature))}, &Success
		case 4046:
			return []uint16{uint16(int16(b.exhaustTemperature))}, &Success
		case 4100:
			if b.filterDirty {
				return []uint16{1}, &Success
			}
			return []uint16{0}, &Success
		}
		// 6100 deliberately does NOT answer here: it is a parameter register,
		// reachable only through FC3. A definition that reads it as an input
		// register gets this exception instead of a plausible-looking 0.
		return []uint16{}, &IllegalDataAddress
	})

	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataValue
		}
		switch register {
		case 6100:
			return []uint16{uint16(b.bypassMode)}, &Success
		case 8000:
			return []uint16{uint16(b.controlMode)}, &Success
		case 8002:
			return []uint16{uint16(b.flowSetpoint)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		switch register {
		case 6100:
			if value > 2 {
				log.Printf("rejected bypass mode %d, expected 0, 1 or 2\n", value)
				return &IllegalDataValue
			}
			b.bypassMode = int(value)
			log.Printf(">>> CHANGE: bypassMode=%d\n", b.bypassMode)
			return &Success
		case 8000:
			if value > 2 {
				return &IllegalDataValue
			}
			b.controlMode = int(value)
			log.Printf(">>> CHANGE: controlMode=%d\n", b.controlMode)
			return &Success
		case 8002:
			if b.controlMode != 2 {
				log.Printf("ignored flow rate %d because controlMode=%d, expected 2\n", value, b.controlMode)
				return &IllegalDataValue
			}
			b.flowSetpoint = int(value)
			b.flowIn = int(value) // the fan follows the setpoint
			log.Printf(">>> CHANGE: flowSetpoint=%d\n", b.flowSetpoint)
			return &Success
		}
		return &IllegalDataAddress
	})

	// Function codes the UWA2 board does not expose for these registers.
	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		return &IllegalFunction
	})
	OnWriteCoil(serv, func(address uint16, value bool) *Exception {
		return &IllegalFunction
	})
	OnReadCoils(serv, func(address uint16, numCoils int) ([]bool, *Exception) {
		return []bool{}, &IllegalFunction
	})
	OnReadDiscreteInputs(serv, func(address uint16, numInputs int) ([]bool, *Exception) {
		return []bool{}, &IllegalFunction
	})
}
