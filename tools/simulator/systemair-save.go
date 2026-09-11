package main

import (
	"log"

	. "github.com/tbrandon/mbserver"
)

// SystemairSave simulates a Systemair SAVE unit.
//
// Two quirks of the real unit are modelled deliberately:
//   - the active user mode (input 1161) is enumerated from 0 while the change
//     request (holding 1162) is enumerated from 1, so a write of N reads back
//     as N-1;
//   - fan level 1 (Minimum) and 5 (Maximum) are rejected, and level 0 (Off) is
//     only accepted when register 1353 holds 1.
type SystemairSave struct {
	fanLevel           int // 1131: 0 Off, 2 Low, 3 Normal, 4 High
	userMode           int // 1161: active user mode, 0 Auto .. 6 Holiday
	temperatureSetSP   int // 2001: tenths of degC, range 120..300
	offAllowed         bool
	outsideTemperature int // 12102: tenths of degC
	supplyTemperature  int // 12103: tenths of degC
	extractTemperature int // 12544: tenths of degC
	humidity           int // 12136: percent
	filterRemaining    int // 7005/7006: remaining filter time in seconds
	alarmTypeA         bool
}

func NewSystemairSave() *SystemairSave {
	return &SystemairSave{
		fanLevel:           3,   // Normal
		userMode:           1,   // Manual (reads back as 1, written as 2)
		temperatureSetSP:   210, // 21.0 degC
		offAllowed:         false,
		outsideTemperature: -35, // -3.5 degC
		supplyTemperature:  188,
		extractTemperature: 216,
		humidity:           38,
		filterRemaining:    7776000, // 90 days
		alarmTypeA:         false,
	}
}

func (s *SystemairSave) Configure(serv *Server) {
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataValue
		}
		switch register {
		case 1131:
			return []uint16{uint16(s.fanLevel)}, &Success
		case 1162:
			// The change request reads back as the active mode, offset by one.
			return []uint16{uint16(s.userMode + 1)}, &Success
		case 1353:
			if s.offAllowed {
				return []uint16{1}, &Success
			}
			return []uint16{0}, &Success
		case 2001:
			return []uint16{uint16(int16(s.temperatureSetSP))}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataValue
		}
		switch register {
		case 1161:
			return []uint16{uint16(s.userMode)}, &Success
		case 7005:
			return []uint16{uint16(s.filterRemaining & 0xFFFF)}, &Success
		case 7006:
			return []uint16{uint16(s.filterRemaining / 65535)}, &Success
		case 12102:
			return []uint16{uint16(int16(s.outsideTemperature))}, &Success
		case 12103:
			return []uint16{uint16(int16(s.supplyTemperature))}, &Success
		case 12136:
			return []uint16{uint16(s.humidity)}, &Success
		case 12544:
			return []uint16{uint16(int16(s.extractTemperature))}, &Success
		case 15901:
			if s.alarmTypeA {
				return []uint16{1}, &Success
			}
			return []uint16{0}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		switch register {
		case 1131:
			if value == 0 && !s.offAllowed {
				log.Printf("rejected fan level Off, register 1353 is not 1\n")
				return &IllegalDataValue
			}
			if value == 1 || value > 4 {
				log.Printf("rejected fan level %d, Minimum and Maximum are not allowed\n", value)
				return &IllegalDataValue
			}
			s.fanLevel = int(value)
			log.Printf(">>> CHANGE: fanLevel=%d\n", s.fanLevel)
			return &Success
		case 1162:
			if value < 1 || value > 7 {
				return &IllegalDataValue
			}
			s.userMode = int(value) - 1
			log.Printf(">>> CHANGE: userMode=%d (change request %d)\n", s.userMode, value)
			return &Success
		case 2001:
			if value < 120 || value > 300 {
				log.Printf("rejected temperature setpoint %d, outside 120..300\n", value)
				return &IllegalDataValue
			}
			s.temperatureSetSP = int(value)
			log.Printf(">>> CHANGE: temperatureSetpoint=%d\n", s.temperatureSetSP)
			return &Success
		}
		return &IllegalDataAddress
	})

	// Not exposed by the SAVE Modbus interface.
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
