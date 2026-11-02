import rodinnyDum from "../../houses/rodinny-dum.json";
import testovaciDum from "../../houses/testovaci-dum.json";
import { parseHouse } from "./house.ts";
import type { House } from "./house.ts";

export const PRESET_HOUSES: readonly House[] = [
  parseHouse("testovaci-dum", testovaciDum),
  parseHouse("rodinny-dum", rodinnyDum),
];
