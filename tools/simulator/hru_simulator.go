package main

import (
	"fmt"
	"os"
	"time"

	"github.com/tbrandon/mbserver"
)

type HRULogic interface {
	Configure(serv *mbserver.Server)
}

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "Error: missing argument. Usage: hru_simulator <port> <xvent|meltem>")
		os.Exit(1)
	}

	var logic HRULogic
	switch os.Args[2] {
	case "xvent":
		logic = NewXvent()
	case "meltem":
		logic = NewMeltem()
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown HRU type '%s'. Valid options: xvent, meltem\n", os.Args[1])
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
