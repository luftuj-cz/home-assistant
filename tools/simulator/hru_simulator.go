package main

import (
	"fmt"
	"os"
	"time"

	"github.com/tbrandon/mbserver"
)

// Every unit the switch in main() knows about, in the order they were added.
const supportedUnits = "xvent, meltem, atrea-rd5, atrea-am, korado, zehnder, brink, systemair-save, domekt-c6"

type HRULogic interface {
	Configure(serv *mbserver.Server)
}

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "Error: missing argument. Usage: hru_simulator <port> <hru_type>. Supported: "+supportedUnits)
		os.Exit(1)
	}

	var logic HRULogic
	switch os.Args[2] {
	case "xvent":
		logic = NewXvent()
	case "meltem":
		logic = NewMeltem()
	case "atrea-rd5":
		logic = NewAtreaRD5()
	case "atrea-am":
		logic = NewAtreaAM(380)
	case "korado":
		logic = NewKorado()
	case "zehnder":
		logic = NewZehnder()
	case "brink":
		logic = NewBrink()
	case "systemair-save":
		logic = NewSystemairSave()
	case "domekt-c6":
		logic = NewDomektC6()
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown HRU type '%s'. Valid options: %s\n", os.Args[2], supportedUnits)
		os.Exit(1)
	}

	serv := mbserver.NewServer()
	err := serv.ListenTCP("0.0.0.0:" + os.Args[1])
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	defer serv.Close()

	logic.Configure(serv)

	fmt.Printf("Listening on %s as %s (hit Ctrl+C to stop)\n", os.Args[1], os.Args[2])

	for {
		time.Sleep(1 * time.Second)
	}
}
