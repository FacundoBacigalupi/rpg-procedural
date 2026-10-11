// Tier 1: el dormido (simulation §4.2, §7-§8). Un registro por persona dormida: desde cuándo y
// hasta cuándo se la avanzó. Lo leen los procesos que dejan de correr para ella (el cuerpo, la
// rutina, la decisión) y lo mantiene `game/life/sleepers.ts`, que la pone al día por tramos.

import type { Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

export interface Asleep {
  readonly since: Tick;
  readonly lastAdvanced: Tick;
  /** Pedido de despertar: `life.catch_up` lo pone al día y borra el registro (off-3). */
  readonly wake?: boolean;
}

export const ASLEEP = table<Asleep>("sim.asleep");
