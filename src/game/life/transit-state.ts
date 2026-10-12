// Estado compartido del tránsito: la posición física confirmada no es el destino del tramo.
import type { Tick } from "../../core/index.ts";
import { table } from "../../sim/index.ts";

export interface Walk {
  readonly from: number;
  readonly to: number;
  readonly path: readonly number[];
  readonly t0: Tick;
  readonly seconds: number;
}

export interface Transit {
  readonly seen: number;
  readonly at: Tick;
  readonly walk?: Walk;
}

export const TRANSIT = table<Transit>("life.transit");
