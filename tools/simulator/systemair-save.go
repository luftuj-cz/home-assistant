package main

import (
	"log"

	. "github.com/tbrandon/mbserver"
)

// SystemairSave simulates a Systemair SAVE unit driven through external fan
// control (Modbus registers 12928/12929 and 12978/12979).
//
// Addresses are 0-based protocol addresses, i.e. the register numbers from
// the Systemair documentation minus one (doc register 2001 is address 2000).
//
// Quirks of the real unit are modelled deliberately:
//   - the active user mode (input 1160) is enumerated from 0 while the change
//     request (holding 1161) is enumerated from 1, so a write of N reads back
//     as N-1;
//   - fan values only take effect in user mode Auto with the matching
//     SAFC/EAFC mode register set to 1, otherwise a warning is logged;
//   - registers 12928, 12929, 12978 and 12979 reset to 0 after a power-off,
//     which is why the definition writes them on every change.
type SystemairSave struct {
	userMode           int // 1160: active user mode, 0 Auto .. 6 Holiday
	safcMode           int // 12928: external supply fan control allowed
	eafcMode           int // 12929: external extract fan control allowed
	safcValue          int // 12978: supply fan, percent
	eafcValue          int // 12979: extract fan, percent
	temperatureSetSP   int // 2000: tenths of degC, range 120..300
	defrostingMode     int // 4000: 0 Soft, 1 Normal, 2 Hard
	outsideTemperature int // 12101: tenths of degC
	supplyTemperature  int // 12102: tenths of degC
	pdmTemperature     int // 12543: in-built extract air sensor, tenths of degC
	humidity           int // 12135: percent
	filterRemaining    int // 7004/7005: remaining filter time in seconds
	alarmTypeA         bool
}

func NewSystemairSave() *SystemairSave {
	return &SystemairSave{
		userMode:           1, // Manual (reads back as 1, written as 2)
		safcMode:           0,
		eafcMode:           0,
		safcValue:          0,
		eafcValue:          0,
		temperatureSetSP:   210, // 21.0 degC
		defrostingMode:     1,   // Normal
		outsideTemperature: -35, // -3.5 degC
		supplyTemperature:  188,
		pdmTemperature:     216,
		humidity:           38,
		filterRemaining:    7776000, // 90 days
		alarmTypeA:         false,
	}
}

func (s *SystemairSave) heatingActive() bool {
	return s.supplyTemperature < s.temperatureSetSP
}

func (s *SystemairSave) defrostingActive() bool {
	return s.outsideTemperature < -50
}

func (s *SystemairSave) checkExternalControl(fan string, mode int) {
	if s.userMode != 0 {
		log.Printf("warning: %s fan value ignored by real unit, user mode is %d, not Auto\n", fan, s.userMode)
	}
	if mode != 1 {
		log.Printf("warning: %s fan value ignored by real unit, external control not allowed\n", fan)
	}
}

func (s *SystemairSave) Configure(serv *Server) {
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataValue
		}
		switch register {
		case 1161:
			// The change request reads back as the active mode, offset by one.
			return []uint16{uint16(s.userMode + 1)}, &Success
		case 2000:
			return []uint16{uint16(int16(s.temperatureSetSP))}, &Success
		case 4000:
			return []uint16{uint16(s.defrostingMode)}, &Success
		case 12928:
			return []uint16{uint16(s.safcMode)}, &Success
		case 12929:
			return []uint16{uint16(s.eafcMode)}, &Success
		case 12978:
			return []uint16{uint16(s.safcValue)}, &Success
		case 12979:
			return []uint16{uint16(s.eafcValue)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		// The filter time is read as one 32-bit pair, low word first.
		if register == 7004 && numRegs == 2 {
			return []uint16{uint16(s.filterRemaining & 0xFFFF), uint16(s.filterRemaining >> 16)}, &Success
		}
		if numRegs != 1 {
			return []uint16{}, &IllegalDataValue
		}
		switch register {
		case 1160:
			return []uint16{uint16(s.userMode)}, &Success
		case 3102:
			return []uint16{boolRegister(s.heatingActive())}, &Success
		case 3103:
			return []uint16{boolRegister(s.defrostingActive())}, &Success
		case 7004:
			return []uint16{uint16(s.filterRemaining & 0xFFFF)}, &Success
		case 7005:
			return []uint16{uint16(s.filterRemaining >> 16)}, &Success
		case 12101:
			return []uint16{uint16(int16(s.outsideTemperature))}, &Success
		case 12102:
			return []uint16{uint16(int16(s.supplyTemperature))}, &Success
		case 12135:
			return []uint16{uint16(s.humidity)}, &Success
		case 12543:
			return []uint16{uint16(int16(s.pdmTemperature))}, &Success
		case 15900:
			return []uint16{boolRegister(s.alarmTypeA)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		switch register {
		case 1161:
			if value < 1 || value > 7 {
				return &IllegalDataValue
			}
			s.userMode = int(value) - 1
			log.Printf(">>> CHANGE: userMode=%d (change request %d)\n", s.userMode, value)
			return &Success
		case 2000:
			if value < 120 || value > 300 {
				log.Printf("rejected temperature setpoint %d, outside 120..300\n", value)
				return &IllegalDataValue
			}
			s.temperatureSetSP = int(value)
			log.Printf(">>> CHANGE: temperatureSetpoint=%d\n", s.temperatureSetSP)
			return &Success
		case 4000:
			if value > 2 {
				return &IllegalDataValue
			}
			s.defrostingMode = int(value)
			log.Printf(">>> CHANGE: defrostingMode=%d\n", s.defrostingMode)
			return &Success
		case 12928:
			if value > 1 {
				return &IllegalDataValue
			}
			s.safcMode = int(value)
			log.Printf(">>> CHANGE: safcMode=%d\n", s.safcMode)
			return &Success
		case 12929:
			if value > 1 {
				return &IllegalDataValue
			}
			s.eafcMode = int(value)
			log.Printf(">>> CHANGE: eafcMode=%d\n", s.eafcMode)
			return &Success
		case 12978:
			if value > 100 {
				return &IllegalDataValue
			}
			s.checkExternalControl("supply", s.safcMode)
			s.safcValue = int(value)
			log.Printf(">>> CHANGE: safcValue=%d%%\n", s.safcValue)
			return &Success
		case 12979:
			if value > 100 {
				return &IllegalDataValue
			}
			s.checkExternalControl("extract", s.eafcMode)
			s.eafcValue = int(value)
			log.Printf(">>> CHANGE: eafcValue=%d%%\n", s.eafcValue)
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
