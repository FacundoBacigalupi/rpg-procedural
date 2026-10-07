import type { Tick } from "../../core/index.ts";
import { table } from "../../sim/index.ts";

/** El personaje del jugador: el agente que el usuario maneja (player-loop §1). */
export const PLAYER = table<{ readonly since: Tick }>("player");
