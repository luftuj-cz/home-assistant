package main

import (
	"log"

	. "github.com/tbrandon/mbserver"
)

// SpSabik simulates an Elektrodesign S&P Sabik unit (Soler & Palau P0002 controller).
//
// The vendor map is 1-based per area (coil 1, discrete input 10001, input register
// 30001, holding register 40001): register N lives at Modbus protocol address N-1
// of its area. The comments below use the vendor numbering; the switch cases use
// protocol addresses.
//
// Power-on defaults are the values read from a real Sabik 350 (model 7 in HR 41076).
type SpSabik struct {
	filterDays         int  // IR 30003: days until next filter change
	roomTemperature    int  // IR 30026: ETA, tenths of degC
	exhaustTemperature int  // IR 30027: EHA, tenths of degC
	outsideTemperature int  // IR 30028: ODA, tenths of degC
	supplyTemperature  int  // IR 30029: SUP, tenths of degC
	roomHumidity       int  // IR 30030: ETA, %
	exhaustHumidity    int  // IR 30031: EHA, %
	outsideHumidity    int  // IR 30032: ODA, %
	supplyHumidity     int  // IR 30033: SUP, %
	lastAlarm          int  // IR 30059: 0 no alarm .. 22
	alarm              bool // DI 10001
	filterAlarm        bool // DI 10002
	nominalFlow        int  // HR 40129: m3/h, minFlow..maxFlow
	speedSelect        int  // HR 40133: 0 humidity prevention, 1 reduced, 2 nominal, 3 auto, 4 snooze
	reducedPercent     int  // HR 40130
	humidityPercent    int  // HR 40131
	boostPercent       int  // HR 40128
	minFlow            int  // HR 41070: model minimum of HR 40129
	maxFlow            int  // HR 41071: model maximum of HR 40129
	manualBypass       bool // coil 8
	autoBypass         bool // coil 9
	boost              bool // coil 17
	snooze             bool // coil 18
}

func NewSpSabik() *SpSabik {
	return &SpSabik{
		filterDays:         359,
		roomTemperature:    221,
		exhaustTemperature: 222,
		outsideTemperature: 221,
		supplyTemperature:  223,
		roomHumidity:       47,
		exhaustHumidity:    47,
		outsideHumidity:    47,
		supplyHumidity:     48,
		nominalFlow:        250,
		speedSelect:        0,
		reducedPercent:     70,
		humidityPercent:    42,
		boostPercent:       130,
		minFlow:            140,
		maxFlow:            260,
		autoBypass:         true,
	}
}

// activeMode is IR 30091, which numbers the modes differently from HR 40133.
func (s *SpSabik) activeMode() int {
	switch {
	case s.snooze || s.speedSelect == 4:
		return 0
	case s.boost:
		return 4
	case s.speedSelect == 3:
		return 9 // auto, weekly program 1
	default:
		return s.speedSelect + 1
	}
}

// setpointFlow is the airflow requested from both fans (IR 30107 / 30108).
func (s *SpSabik) setpointFlow() int {
	switch s.activeMode() {
	case 0:
		return 0
	case 1:
		return s.nominalFlow * s.humidityPercent / 100
	case 2:
		return s.nominalFlow * s.reducedPercent / 100
	case 4:
		return s.nominalFlow * s.boostPercent / 100
	default:
		return s.nominalFlow
	}
}

// Automatic bypass thresholds in tenths of degC: vendor defaults of HR 40064,
// 40066 and 40068, which the definition does not expose.
const (
	sabikBypassMinOutside = 130
	sabikBypassMinRoom    = 230
	sabikBypassMinDiff    = 30
)

// bypassPosition is IR 30064: 0 closed, 1 open.
func (s *SpSabik) bypassPosition() uint16 {
	if s.manualBypass {
		return 1
	}
	if s.autoBypass &&
		s.outsideTemperature >= sabikBypassMinOutside &&
		s.roomTemperature >= sabikBypassMinRoom &&
		s.roomTemperature-s.outsideTemperature >= sabikBypassMinDiff {
		return 1
	}
	return 0
}

func (s *SpSabik) Configure(serv *Server) {
	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataAddress
		}
		switch register {
		case 2:
			return []uint16{uint16(s.filterDays)}, &Success
		case 25:
			return []uint16{uint16(int16(s.roomTemperature))}, &Success
		case 26:
			return []uint16{uint16(int16(s.exhaustTemperature))}, &Success
		case 27:
			return []uint16{uint16(int16(s.outsideTemperature))}, &Success
		case 28:
			return []uint16{uint16(int16(s.supplyTemperature))}, &Success
		case 29:
			return []uint16{uint16(s.roomHumidity)}, &Success
		case 30:
			return []uint16{uint16(s.exhaustHumidity)}, &Success
		case 31:
			return []uint16{uint16(s.outsideHumidity)}, &Success
		case 32:
			return []uint16{uint16(s.supplyHumidity)}, &Success
		case 58:
			return []uint16{uint16(s.lastAlarm)}, &Success
		case 63:
			return []uint16{s.bypassPosition()}, &Success
		case 90:
			return []uint16{uint16(s.activeMode())}, &Success
		case 106, 107:
			return []uint16{uint16(s.setpointFlow())}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnReadDiscreteInputs(serv, func(address uint16, numInputs int) ([]bool, *Exception) {
		if numInputs != 1 {
			return []bool{}, &IllegalDataAddress
		}
		switch address {
		case 0:
			return []bool{s.alarm || s.filterAlarm}, &Success
		case 1:
			return []bool{s.filterAlarm}, &Success
		}
		return []bool{}, &IllegalDataAddress
	})

	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if numRegs != 1 {
			return []uint16{}, &IllegalDataAddress
		}
		switch register {
		case 128:
			return []uint16{uint16(s.nominalFlow)}, &Success
		case 132:
			return []uint16{uint16(s.speedSelect)}, &Success
		case 1069:
			return []uint16{uint16(s.minFlow)}, &Success
		case 1070:
			return []uint16{uint16(s.maxFlow)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		v := int(value)
		inRange := func(min, max int) bool { return v >= min && v <= max }
		switch register {
		case 128:
			if !inRange(s.minFlow, s.maxFlow) {
				return &IllegalDataValue
			}
			s.nominalFlow = v
			log.Printf(">>> CHANGE: nominalFlow=%d\n", v)
		case 132:
			if !inRange(0, 4) {
				return &IllegalDataValue
			}
			s.speedSelect = v
			log.Printf(">>> CHANGE: speedSelect=%d\n", v)
		default:
			return &IllegalDataAddress
		}
		return &Success
	})

	OnReadCoils(serv, func(address uint16, numCoils int) ([]bool, *Exception) {
		if numCoils != 1 {
			return []bool{}, &IllegalDataAddress
		}
		switch address {
		case 7:
			return []bool{s.manualBypass}, &Success
		case 8:
			return []bool{s.autoBypass}, &Success
		case 16:
			return []bool{s.boost}, &Success
		case 17:
			return []bool{s.snooze}, &Success
		}
		return []bool{}, &IllegalDataAddress
	})

	OnWriteCoil(serv, func(address uint16, value bool) *Exception {
		switch address {
		case 7:
			s.manualBypass = value
			log.Printf(">>> CHANGE: manualBypass=%v\n", value)
		case 8:
			s.autoBypass = value
			log.Printf(">>> CHANGE: autoBypass=%v\n", value)
		case 16:
			s.boost = value
			log.Printf(">>> CHANGE: boost=%v\n", value)
		case 17:
			s.snooze = value
			log.Printf(">>> CHANGE: snooze=%v\n", value)
		default:
			return &IllegalDataAddress
		}
		return &Success
	})

	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		return &IllegalFunction
	})
}
