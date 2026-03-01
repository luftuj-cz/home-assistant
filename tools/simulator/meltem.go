package main

import (
	"github.com/tbrandon/mbserver"
)

type Meltem struct{}

func NewMeltem() *Meltem {
	return &Meltem{}
}

func (m *Meltem) Configure(serv *mbserver.Server) {
	// TODO: Implement Meltem-specific configuration
}
