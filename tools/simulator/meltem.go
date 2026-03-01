package main

import (
	"log"

	. "github.com/tbrandon/mbserver"
)

type Meltem struct {
	inFlow     int
	outFlow    int
	editMode   int
	reqInFlow  int
	reqOutFlow int
}

func NewMeltem() *Meltem {
	return &Meltem{
		inFlow:   0,
		outFlow:  0,
		editMode: 0,
	}
}

func (m *Meltem) Configure(serv *Server) {
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		return []uint16{}, &IllegalDataAddress
	})
	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 41020 && numRegs == 1 {
			return []uint16{uint16(m.outFlow)}, &Success
		}
		if register == 41021 && numRegs == 1 {
			return []uint16{uint16(m.inFlow)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})
	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		if register == 41120 {
			m.editMode = int(value)
			return &Success
		}
		if register == 41121 {
			m.reqInFlow = int(value / 2)
			return &Success
		}
		if register == 41122 {
			m.reqOutFlow = int(value / 2)
			return &Success
		}
		if register == 41132 {
			if value == 0 && m.editMode == 4 {
				m.inFlow = m.reqInFlow
				m.outFlow = m.reqOutFlow
				m.editMode = 0
				log.Printf(">>> Meltem setting: inFlow=%d, outFlow=%d\n", m.inFlow, m.outFlow)
			} else {
				log.Printf("Meltem: invalid edit mode: %d, confirm value: %d\n", m.editMode, value)
				return &IllegalDataValue
			}
		}

		return &IllegalDataAddress
	})
	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		return &IllegalFunction
	})
}
