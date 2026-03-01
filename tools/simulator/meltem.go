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
	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 41020 && numRegs == 1 {
			return []uint16{uint16(m.outFlow)}, &Success
		}
		if register == 41021 && numRegs == 1 {
			return []uint16{uint16(m.inFlow)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})
	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		if register == 41120 && len(values) == 1 {
			m.editMode = int(values[0])
			return &Success
		}
		if register == 41121 && len(values) == 1 {
			m.reqInFlow = int(values[0] / 2)
			return &Success
		}
		if register == 41121 && len(values) == 1 {
			m.reqInFlow = int(values[0] / 2)
			return &Success
		}
		if register == 41132 && len(values) == 1 {
			if values[0] == 0 && m.editMode == 4 {
				m.inFlow = m.reqInFlow
				m.outFlow = m.reqOutFlow
				m.editMode = 0
				log.Printf("Meltem: inFlow=%d, outFlow=%d\n", m.inFlow, m.outFlow)
			}
		}

		return &IllegalDataAddress
	})
}
