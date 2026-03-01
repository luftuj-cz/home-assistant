package main

import (
	"log"

	. "github.com/tbrandon/mbserver"
)

type Xvent struct {
	bypass  bool
	boost   bool
	powerOn bool
	speed   int
}

func NewXvent() *Xvent {
	return &Xvent{
		speed:   2,
		powerOn: true,
	}
}

func (x *Xvent) Configure(serv *Server) {
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 0x9C40 && numRegs == 1 {
			res := x.speed << 6
			if x.powerOn {
				res |= 0x1
			}
			if x.boost {
				res |= 0x10
			}
			if x.bypass {
				res |= 0x4
			}
			return []uint16{uint16(res)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})
	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		return &IllegalFunction
	})
	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		if register == 0x9C40 && len(values) == 1 {
			x.speed = int((values[0] >> 6) & 0xF)
			x.boost = (values[0] & 0x10) != 0
			x.bypass = (values[0] & 0x4) != 0
			x.powerOn = (values[0] & 0x1) != 0
			log.Printf(">>> CHANGE: speed=%d, boost=%v, bypass=%v, powerOn=%v\n", x.speed, x.boost, x.bypass, x.powerOn)
			return &Success
		}
		return &IllegalDataAddress
	})
}
