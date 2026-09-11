# Go Modbus simulator — template and contract

Location: `tools/simulator/`. Flat directory, one `.go` file per unit, `package main`.
Module `luftuj-cz/hru-simulator`, server library `github.com/tbrandon/mbserver`.

## The entire contract

```go
type HRULogic interface {
    Configure(serv *mbserver.Server)
}
```

Implement that method, then add one `case` arm to the switch in `tools/simulator/hru_simulator.go`.
That is all. No config file, no `init()` self-registration, no `go.mod` change, no plugin registry.

```go
switch os.Args[2] {
case "xvent":     logic = NewXvent()
case "meltem":    logic = NewMeltem()
case "atrea-rd5": logic = NewAtreaRD5()
case "atrea-am":  logic = NewAtreaAM(380)
case "korado":    logic = NewKorado()
case "zehnder":   logic = NewZehnder()
// case "<code>": logic = New<Name>()     <- add here
}
```

Pass a constructor argument only if `main` supplies a constant, as `NewAtreaAM(380)` does for the maximum
absolute airflow.

## The seven helpers (`tools/simulator/hru.go`)

Each parses the PDU big-endian, logs one line, calls your closure, and encodes the response.
Coil responses are bit-packed for you — just return `[]bool`.

```go
func OnReadHoldingRegisters (s *Server, fn func(register uint16, numRegs int) ([]uint16, *Exception))  // FC3
func OnReadInputRegisters   (s *Server, fn func(register uint16, numRegs int) ([]uint16, *Exception))  // FC4
func OnReadCoils            (s *Server, fn func(address uint16, numCoils int) ([]bool, *Exception))    // FC1
func OnReadDiscreteInputs   (s *Server, fn func(address uint16, numInputs int) ([]bool, *Exception))   // FC2
func OnWriteHoldingRegister (s *Server, fn func(register uint16, value uint16) *Exception)             // FC6
func OnWriteHoldingRegisters(s *Server, fn func(register uint16, data []uint16) *Exception)            // FC16
func OnWriteCoil            (s *Server, fn func(address uint16, value bool) *Exception)                // FC5
```

All unit files use a dot-import (`. "github.com/tbrandon/mbserver"`), so `Server`, `Exception`, `Success`,
`IllegalDataAddress` and `IllegalFunction` are unqualified. Only `hru_simulator.go` uses the qualified form.

Requests are serialised through a single goroutine inside `mbserver`, so **no locking is needed** in your state.

## JSON function → simulator helper

The simulator must serve exactly the addresses the definition references.

| JSON function | Simulator helper |
|---|---|
| `modbus_read_holding` | `OnReadHoldingRegisters` |
| `modbus_read_input` | `OnReadInputRegisters` |
| `modbus_read_coil` | `OnReadCoils` |
| `modbus_read_discrete` | `OnReadDiscreteInputs` |
| `modbus_write_holding` | `OnWriteHoldingRegister` |
| `modbus_write_holding_multi` | `OnWriteHoldingRegisters` |
| `modbus_write_coil` | `OnWriteCoil` |

## Skeleton

Modelled on `korado.go`. Three parts: state struct, constructor with power-on defaults, `Configure`.

```go
package main

import (
	"log"

	. "github.com/tbrandon/mbserver"
)

// 1) mutable state — one unexported field per simulated quantity
type Acme struct {
	power                int // %
	mode                 int
	requestedTemperature int // pre-scaled: tenths of °C
	insideTemperature    int // pre-scaled
	outsideTemperature   int // pre-scaled
	error                bool
}

// 2) realistic power-on defaults
func NewAcme() *Acme {
	return &Acme{
		power:                40,
		mode:                 2,
		requestedTemperature: 215, // 21.5 °C
		insideTemperature:    213,
		outsideTemperature:   -58, // negative values are fine as int; convert on read
		error:                false,
	}
}

// 3) one closure per supported function code
func (a *Acme) Configure(serv *Server) {
	OnReadHoldingRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 100 && numRegs == 1 {
			return []uint16{uint16(a.power)}, &Success
		}
		if register == 101 && numRegs == 1 {
			return []uint16{uint16(a.mode)}, &Success
		}
		if register == 102 && numRegs == 1 {
			return []uint16{uint16(a.requestedTemperature)}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnReadInputRegisters(serv, func(register uint16, numRegs int) ([]uint16, *Exception) {
		if register == 200 && numRegs == 1 {
			return []uint16{uint16(int16(a.insideTemperature))}, &Success
		}
		if register == 201 && numRegs == 1 {
			return []uint16{uint16(int16(a.outsideTemperature))}, &Success
		}
		return []uint16{}, &IllegalDataAddress
	})

	OnWriteHoldingRegister(serv, func(register uint16, value uint16) *Exception {
		switch register {
		case 100:
			a.power = int(value)
			log.Printf(">>> CHANGE: power=%d\n", a.power)
			return &Success
		case 101:
			a.mode = int(value)
			log.Printf(">>> CHANGE: mode=%d\n", a.mode)
			return &Success
		case 102:
			a.requestedTemperature = int(value)
			log.Printf(">>> CHANGE: requestedTemperature=%d\n", a.requestedTemperature)
			return &Success
		}
		return &IllegalDataAddress
	})

	OnReadDiscreteInputs(serv, func(address uint16, numInputs int) ([]bool, *Exception) {
		if address == 1 && numInputs == 1 {
			return []bool{a.error}, &Success
		}
		return []bool{}, &IllegalDataAddress
	})

	// Reject everything this unit does not support — see gotcha 1.
	OnWriteHoldingRegisters(serv, func(register uint16, values []uint16) *Exception {
		return &IllegalFunction
	})
	OnWriteCoil(serv, func(address uint16, value bool) *Exception {
		return &IllegalFunction
	})
	OnReadCoils(serv, func(address uint16, numCoils int) ([]bool, *Exception) {
		return []bool{}, &IllegalFunction
	})
}
```

## Gotchas

Each of these silently corrupts behaviour.

1. **Always register `&IllegalFunction` stubs for unsupported function codes.** `mbserver.NewServer()` installs
   default handlers for FC 1, 2, 3, 4, 5, 6, 15 and 16 backed by its own 64K zero-filled arrays. If you leave one
   unregistered, the simulator cheerfully answers reads it should refuse — and returns `0`, which looks like a
   plausible sensor value.
2. **Guard every read with `numRegs == 1`.** The backend never batches: `modbus_read_*` returns `data[0]` only,
   with `count` defaulting to 1.
3. **Exceptions are pointers to package vars** — `&Success`, `&IllegalDataAddress`, `&IllegalDataValue`,
   `&IllegalFunction`. Never construct one. `Success` is the zero value.
4. **Negative temperatures** — store as a signed `int` and convert with `uint16(int16(v))` on the way out, or
   hardcode the two's-complement value (`korado.go` returns the literal `65404` for −13.2 °C). The backend's
   `int16()` function does the reverse.
5. **`value / 10.0` on a `uint16` is integer division.** `atrea-am.go` and `atrea-rd5.go` contain
   `a.temperature = float64(value / 10.0)`, which turns a write of `215` into `21.0`, not `21.5`. In new code
   write `float64(value) / 10.0`, or keep temperatures pre-scaled as `int` (the Zehnder approach) and avoid
   floats entirely. Prefer the pre-scaled `int`.
6. **Log every mutation** as `log.Printf(">>> CHANGE: field=%v\n", ...)`. The verification checklist depends on
   those lines to confirm a write landed.
7. **Leave `go.mod` alone.** The three requires are tagged `// indirect` although they are direct;
   `go mod tidy` rewrites that for no benefit and creates diff noise.

## Protocol idioms

Copy the matching one when the vendor documentation describes a handshake. Each has a live example in the repo.

### Unlock-then-write (`atrea-rd5.go`)

Writing `0` to an unlock register sets a flag; the subsequent write to the value register is accepted only while
that flag is set, and clears it.

```go
if register == 10700 && value == 0 {
    a.editPower = true
    return &Success
}
if register == 10708 && a.editPower {
    a.power = int(value)
    a.editPower = false
    log.Printf(">>> CHANGE: power=%d\n", a.power)
    return &Success
}
// falls through to &IllegalDataAddress when the unlock never happened
```

Guarding with `&& a.editPower` rather than an inner check means a write without the unlock falls through to the
final `return &IllegalDataAddress` — which is what surfaces a definition that forgot the unlock statement.

### Edit-mode + commit register (`meltem.go`)

Staged values are held until a commit write, and only applied if the edit-mode register holds the magic value.

```go
if register == 41132 {
    if value == 0 && m.editMode == 4 {
        m.inFlow = m.reqInFlow
        m.outFlow = m.reqOutFlow
        m.editMode = 0
        log.Printf(">>> CHANGE inFlow=%d, outFlow=%d\n", m.inFlow, m.outFlow)
        return &Success
    }
    log.Printf("Invalid edit mode: %d, confirm value: %d\n", m.editMode, value)
    return &IllegalDataValue
}
```

The staged values only become live on commit, and `editMode` resets so a second commit without a fresh
edit-mode write is rejected.

### Keep-alive watchdog (`korado.go`)

Writes are ignored unless a heartbeat coil was written recently. Model this whenever the definition has an
`integration.keepAlive` block — it is the only way to catch a missing or mistimed heartbeat.

```go
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
OnWriteCoil(serv, func(address uint16, value bool) *Exception {
    if address == 31 && value {
        k.lastAlive = time.Now()
        return &Success
    }
    return &IllegalDataAddress
})
```

Note it still returns `&Success` for an ignored write — that is what the real device does, and it is exactly the
failure the simulator exists to reproduce.

### Packed bitfield (`xvent.go`)

One holding register carries several fields; read and write the whole word.

```go
// speed<<6 | boost(0x10) | bypass(0x4) | powerOn(0x1)
frontPanel := x.speed<<6 | boost | bypass | powerOn
```

### Coupled units (`atrea-am.go`)

Relative (%) and absolute (m³/h) power are two views of one quantity — writing either recomputes the other
through a maximum supplied to the constructor.

## Build and run

```bash
cd tools/simulator
go build luftuj-cz/hru-simulator
./hru-simulator 5502 <code>
```

- Port is a **mandatory positional argument**; there is no default and no flag parsing. Binds `0.0.0.0`.
- Port 502 needs root on Linux — use a high port and set the addon's HRU port to match.
- The slave/unit ID is not filtered for TCP, so any `unitId` from the client works.
- Stops on Ctrl+C. Go toolchain is pinned to 1.26.2 by `mise.toml`; `go.mod` declares `go 1.25.0`.
- No tests exist for the simulator, and no CI job builds it.
