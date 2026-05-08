package main

import (
	. "github.com/tbrandon/mbserver"
)

type Zehnder struct {
	error                  bool
	connectionState        byte
	ventilationMode        int
	temperatureProfile     int
	temperatureProfileMode int
	requestedTemperature   int
	comfoClime             bool
	roomTemperature        int
	insideTemperature      int
	outsideTemperature     int
	supplyTemperature      int
	exhaustTemperature     int
	roomHumidity           int
	insideHumidity         int
	replaceFilterDays      int
	changeFilter           bool
}

func NewZehnder() *Zehnder {
	return &Zehnder{
		error:                  false,
		connectionState:        0,
		ventilationMode:        1,
		temperatureProfile:     0,
		temperatureProfileMode: 0,
		requestedTemperature:   21,
		comfoClime:             false,
		roomTemperature:        210,
		insideTemperature:      210,
		outsideTemperature:     140,
		supplyTemperature:      190,
		exhaustTemperature:     210,
		roomHumidity:           40,
		insideHumidity:         40,
		replaceFilterDays:      300,
		changeFilter:           false,
	}
}

func (m *Zehnder) Configure(serv *Server) {
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 1 && numRegs == 1 {
			return []uint16{uint16(m.ventilationMode)}, &Success
		}
		if register == 2 && numRegs == 1 {
			return []uint16{uint16(m.temperatureProfile)}, &Success
		}
		if register == 3 && numRegs == 1 {
			return []uint16{uint16(m.temperatureProfileMode)}, &Success
		}
		if register == 4 && numRegs == 1 {
			return []uint16{uint16(m.requestedTemperature)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})
	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 1 && numRegs == 1 {
			return []uint16{uint16(m.connectionState)}, &Success
		}
		if register == 0x1A && numRegs == 1 {
			return []uint16{uint16(m.replaceFilterDays)}, &Success
		}
		if register == 0x8 && numRegs == 1 {
			return []uint16{uint16(m.roomTemperature)}, &Success
		}
		if register == 0x9 && numRegs == 1 {
			return []uint16{uint16(m.insideTemperature)}, &Success
		}
		if register == 0xA && numRegs == 1 {
			return []uint16{uint16(m.exhaustTemperature)}, &Success
		}
		if register == 0xB && numRegs == 1 {
			return []uint16{uint16(m.outsideTemperature)}, &Success
		}
		if register == 0xC && numRegs == 1 {
			return []uint16{uint16(m.supplyTemperature)}, &Success
		}
		if register == 0xD && numRegs == 1 {
			return []uint16{uint16(m.roomHumidity)}, &Success
		}
		if register == 0xE && numRegs == 1 {
			return []uint16{uint16(m.insideHumidity)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})
	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		if register == 1 {
			m.ventilationMode = int(value)
			return &Success
		}
		if register == 2 {
			m.temperatureProfile = int(value)
			return &Success
		}
		if register == 3 {
			m.temperatureProfileMode = int(value)
			return &Success
		}
		if register == 4 {
			m.requestedTemperature = int(value)
			return &Success
		}
		return &IllegalDataAddress
	})
	OnWriteCoil(serv, func(register uint16, value bool) *Exception {
		if register == 3 {
			m.comfoClime = value
			return &Success
		}
		return &IllegalDataAddress
	})
	OnReadCoils(serv, func(register uint16, numCoils int) ([]bool, *Exception) {
		if register == 3 && numCoils == 1 {
			return []bool{m.comfoClime}, &Success
		}
		return []bool{}, &IllegalDataAddress
	})
	OnReadDiscreteInputs(serv, func(address uint16, numInputs int) ([]bool, *Exception) {
		if address == 1 {
			return []bool{m.error}, &Success
		}
		if address == 4 {
			return []bool{m.changeFilter}, &Success
		}
		return []bool{}, &IllegalDataAddress
	})

	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		return &IllegalFunction
	})
}
