package main

import (
	"log"
	"math"

	. "github.com/tbrandon/mbserver"
)

type AtreaAM struct {
	powerRelative    float64
	powerAbsolute    float64
	powerAbsoluteMax int
	temperature      float64
	mode             int
}

func NewAtreaAM(max int) *AtreaAM {
	return &AtreaAM{
		powerRelative:    50.0,
		powerAbsolute:    float64(max) * 50.0 / 100.0,
		powerAbsoluteMax: max,
		temperature:      26,
		mode:             1,
	}
}

func (a *AtreaAM) Configure(serv *Server) {
	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 1004 && numRegs == 1 {
			return []uint16{uint16(a.powerRelative)}, &Success
		}
		if register == 1005 && numRegs == 1 {
			return []uint16{uint16(a.powerAbsolute)}, &Success
		}
		if register == 1001 && numRegs == 1 {
			return []uint16{uint16(a.mode)}, &Success
		}
		if register == 1002 && numRegs == 1 {
			return []uint16{uint16(math.Round(a.temperature * 10))}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})
	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		if register == 1004 {
			a.powerRelative = float64(value)
			a.powerAbsolute = a.powerRelative / 100.0 * float64(a.powerAbsoluteMax)
			log.Printf(">>> CHANGE: powerRelative=%d, powerAbsolute=%d\n", math.Round(a.powerRelative), math.Round(a.powerAbsolute))
			return &Success
		}
		if register == 1005 {
			a.powerAbsolute = float64(value)
			a.powerRelative = a.powerAbsolute / float64(a.powerAbsoluteMax) * 100.0
			log.Printf(">>> CHANGE: powerRelative=%d, powerAbsolute=%d\n", math.Round(a.powerRelative), math.Round(a.powerAbsolute))
			return &Success
		}
		if register == 1001 {
			a.mode = int(value)
			log.Printf(">>> CHANGE: mode=%d\n", a.mode)
			return &Success
		}
		if register == 1002 {
			a.temperature = float64(value / 10.0)
			log.Printf(">>> CHANGE: temperature=%f\n", a.temperature)
			return &Success
		}
		return &IllegalDataAddress
	})
	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		return &IllegalFunction
	})
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		return []uint16{}, &IllegalFunction
	})
}
