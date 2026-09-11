package main

import (
	"log"

	. "github.com/tbrandon/mbserver"
)

// Brink simulates a Brink HRA with a UWA2-B / UWA2-E Modbus board.
//
// Control handshake: holding register 8000 selects the control source
// (0 = off, 1 = switch position, 2 = flow rate). A write to 8002 is only
// accepted while 8000 holds the value 2.
type Brink struct {
	controlMode        int // 8000: 0 off, 1 switch position, 2 flow rate
	flowSetpoint       int // 8002: desired flow rate in m3/h
	bypassTemperature  int // 6101: tenths of degC, range 150..350
	ventilationMode    int // 4022: 0 Holiday, 1 Low, 2 Normal, 3 High, 4 Auto
	flowIn             int // 4032: current supply air flow in m3/h
	supplyTemperature  int // 4036: tenths of degC
	outsideTemperature int // 4081: tenths of degC (NTC 1)
	roomTemperature    int // 4082: tenths of degC (NTC 2)
	humidity           int // 4083: relative humidity, range 0..1000
	filterDirty        bool
}

func NewBrink() *Brink {
	return &Brink{
		controlMode:        0,
		flowSetpoint:       150,
		bypassTemperature:  220, // 22.0 degC, the documented default
		ventilationMode:    2,   // Normal
		flowIn:             148,
		supplyTemperature:  195,
		outsideTemperature: -42, // -4.2 degC
		roomTemperature:    211,
		humidity:           455, // 45.5 %
		filterDirty:        false,
	}
}

func (b *Brink) Configure(serv *Server) {
	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataValue
		}
		switch register {
		case 4022:
			return []uint16{uint16(b.ventilationMode)}, &Success
		case 4032:
			return []uint16{uint16(b.flowIn)}, &Success
		case 4036:
			return []uint16{uint16(int16(b.supplyTemperature))}, &Success
		case 4081:
			return []uint16{uint16(int16(b.outsideTemperature))}, &Success
		case 4082:
			return []uint16{uint16(int16(b.roomTemperature))}, &Success
		case 4083:
			return []uint16{uint16(b.humidity)}, &Success
		case 4100:
			if b.filterDirty {
				return []uint16{1}, &Success
			}
			return []uint16{0}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataValue
		}
		switch register {
		case 6101:
			return []uint16{uint16(int16(b.bypassTemperature))}, &Success
		case 8000:
			return []uint16{uint16(b.controlMode)}, &Success
		case 8002:
			return []uint16{uint16(b.flowSetpoint)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		switch register {
		case 6101:
			// Documented range 150..350 in tenths of a degree, step 5.
			if value < 150 || value > 350 {
				log.Printf("rejected bypass temperature %d, outside 150..350\n", value)
				return &IllegalDataValue
			}
			b.bypassTemperature = int(value)
			log.Printf(">>> CHANGE: bypassTemperature=%d\n", b.bypassTemperature)
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
