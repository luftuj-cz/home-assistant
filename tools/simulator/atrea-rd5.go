package main

import (
	"log"
	"math"

	. "github.com/tbrandon/mbserver"
)

type AtreaRD5 struct {
	power           int
	temperature     float64
	mode            int
	editPower       bool
	editTemperature bool
	editMode        bool
}

func NewAtreaRD5() *AtreaRD5 {
	return &AtreaRD5{
		power:           50,
		temperature:     26,
		mode:            1,
		editPower:       false,
		editMode:        false,
		editTemperature: false,
	}
}

func (a *AtreaRD5) Configure(serv *Server) {
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if (register == 10704 || register == 10708) && numRegs == 1 {
			return []uint16{uint16(a.power)}, &Success
		}
		if (register == 10704 || register == 10710) && numRegs == 1 {
			return []uint16{uint16(math.Round(a.temperature * 10))}, &Success
		}
		if (register == 10705 || register == 10709) && numRegs == 1 {
			return []uint16{uint16(a.mode)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})
	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		if register == 10700 && value == 0 {
			a.editPower = true
			return &Success
		}
		if register == 10702 && value == 0 {
			a.editTemperature = true
			return &Success
		}
		if register == 10701 && value == 0 {
			a.editMode = true
			return &Success
		}
		if register == 10708 && a.editPower {
			a.power = int(value)
			a.editPower = false
			log.Printf(">>> CHANGE: power=%d\n", a.power)
			return &Success
		}
		if register == 10710 && a.editTemperature {
			a.temperature = float64(value / 10.0)
			a.editTemperature = false
			log.Printf(">>> CHANGE: temperature=%f\n", a.temperature)
			return &Success
		}
		if register == 10709 && a.editMode {
			a.mode = int(value)
			a.editMode = false
			log.Printf(">>> CHANGE: mode=%d\n", a.mode)
			return &Success
		}
		return &IllegalDataAddress
	})
	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		return &IllegalFunction
	})
}
