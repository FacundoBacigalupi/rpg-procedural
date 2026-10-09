// Paquete de reproducción del narrador (tooling §9): cuando el validador rechaza la narración las
// veces permitidas y el turno sale de las plantillas, se guarda lo mínimo para repetir el caso sin
// el guardado entero: versiones, seed, setup, planes hasta ese turno, la vista, el prompt y la
// salida con los motivos. Es un dato puro; escribirlo a disco es de quien lo pide.

import type { Seed, Tick } from "../../core/index.ts";
import type { LifeSetup } from "../../game/index.ts";
import {
  type Narration,
  type NarrationRequest,
  narratorSystem,
  narratorUserMessage,
} from "../../llm/index.ts";
import type { ReproPackage } from "./sim.ts";

export interface NarratorReproInput {
  readonly versions: ReproPackage["versions"];
  readonly seed: Seed;
  readonly setup: LifeSetup;
  readonly plans: readonly unknown[];
  readonly tick: Tick;
  readonly request: NarrationRequest;
  readonly narration: Narration;
}

/** ¿Hay que armar el paquete? Solo si el modelo estaba y sus salidas se rechazaron. */
export function narrationRejected(n: Narration): boolean {
  return n.source === "templates" && n.problems.some((p) => !p.endsWith("no disponible"));
}

export function narratorRepro(i: NarratorReproInput): ReproPackage {
  return {
    kind: "narrator",
    versions: i.versions,
    seed: i.seed,
    setup: i.setup,
    plans: i.plans,
    tick: i.tick,
    problems: i.narration.problems.slice(0, 50),
    narrator: {
      view: i.request.view,
      system: narratorSystem(i.request.style),
      user: narratorUserMessage(i.request),
      output: i.narration.text,
      source: i.narration.source,
    },
  };
}
