package main

import (
	"encoding/binary"
	"log"

	. "github.com/tbrandon/mbserver"
)

const (
	FnReadCoils             = 1
	FnReadDiscreteInputs    = 2
	FnReadHoldingRegisters  = 3
	FnReadInputRegisters    = 4
	FnWriteSingleCoil       = 5
	FnWriteHoldingRegister  = 6
	FnWriteMultipleCoils    = 15
	FnWriteHoldingRegisters = 16
)

func OnReadHoldingRegisters(s *Server, function func(register uint16, numRegs int) ([]uint16, *Exception)) {
	s.RegisterFunctionHandler(FnReadHoldingRegisters, func(s *Server, frame Framer) ([]byte, *Exception) {
		data := frame.GetData()
		register := binary.BigEndian.Uint16(data[0:2])
		numRegs := int(binary.BigEndian.Uint16(data[2:4]))
		values, err := function(register, numRegs)
		log.Printf("modbus_read_holding_registers: register=%d, number=%v\n", register, numRegs)
		return append([]byte{byte(numRegs * 2)}, Uint16ToBytes(values)...), err
	})
}

func OnWriteHoldingRegisters(s *Server, function func(register uint16, data []uint16) *Exception) {
	s.RegisterFunctionHandler(FnWriteHoldingRegisters, func(s *Server, frame Framer) ([]byte, *Exception) {
		data := frame.GetData()
		register := binary.BigEndian.Uint16(data[0:2])
		valueBytes := frame.GetData()[5:]
		values := BytesToUint16(valueBytes)
		log.Printf("modbus_write_holding_registers: register=%d, values=%v\n", register, values)
		return frame.GetData()[0:4], function(register, values)
	})
}

func OnWriteHoldingRegister(s *Server, function func(register uint16, value uint16) *Exception) {
	s.RegisterFunctionHandler(FnWriteHoldingRegister, func(s *Server, frame Framer) ([]byte, *Exception) {
		data := frame.GetData()
		register := binary.BigEndian.Uint16(data[0:2])
		value := binary.BigEndian.Uint16(data[2:4])
		log.Printf("modbus_write_holding_register: register=%d, value=%d\n", register, value)
		return frame.GetData()[0:4], function(register, value)
	})
}

func OnReadInputRegisters(s *Server, function func(register uint16, numRegs int) ([]uint16, *Exception)) {
	s.RegisterFunctionHandler(FnReadInputRegisters, func(s *Server, frame Framer) ([]byte, *Exception) {
		data := frame.GetData()
		register := binary.BigEndian.Uint16(data[0:2])
		numRegs := int(binary.BigEndian.Uint16(data[2:4]))
		values, err := function(register, numRegs)
		log.Printf("modbus_read_input_registers: register=%d, number=%v\n", register, numRegs)
		return append([]byte{byte(numRegs * 2)}, Uint16ToBytes(values)...), err
	})
}
