package main

import (
	"log"
	"time"

	. "github.com/tbrandon/mbserver"
)

// Ventbox 400 with constant-flow motors reports input 117 in m³/h.
const koradoNominalFlow = 400

type Korado struct {
	power     int
	lastAlive time.Time
}

func NewKorado() *Korado {
	return &Korado{
		power:     20,
		lastAlive: time.Now(),
	}
}

func (k *Korado) Configure(serv *Server) {
	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 100 && numRegs == 1 {
			return []uint16{uint16(12345)}, &Success
		}
		if register == 117 && numRegs == 1 {
			return []uint16{uint16(k.power * koradoNominalFlow / 100)}, &Success
		}
		if register == 110 && numRegs == 1 {
			return []uint16{uint16(457)}, &Success
		}
		if register == 111 && numRegs == 1 {
			return []uint16{uint16(65404)}, &Success
		}
		if (register >= 112 && register <= 114) && numRegs == 1 {
			return []uint16{uint16(200)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 106 && numRegs == 1 {
			return []uint16{uint16(k.power)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})
	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		if register == 106 {
			if time.Since(k.lastAlive) <= 30*time.Second {
				k.power = int(value)
				log.Printf(">>> CHANGE: power=%d\n", k.power)
			} else {
				log.Printf("ignored because last alive %v\n", time.Since(k.lastAlive))
			}
			return &Success
		}
		return &IllegalDataAddress
	})
	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		return &IllegalFunction
	})
	OnWriteCoil(serv, func(address uint16, value bool) *Exception {
		if address == 31 && value {
			k.lastAlive = time.Now()
			return &Success
		}
		return &IllegalDataAddress
	})
}
