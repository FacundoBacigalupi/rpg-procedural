// El inspector en el tiempo (tooling §5, `at <tick>`): rehace la vida desde el seed y los planes
// validados hasta un tick pasado, sobre una copia descartable (nunca toca la vida en curso). El
// estado en el tick t es el de un checkpoint del replay: después de `advanceTo(t)` y antes de
// aplicar los planes de t.

import type { Content, Tick } from "../../core/index.ts";
import { Life, type LifeSetup, optionsOf } from "../../game/index.ts";
import type { ReplayInput } from "../replay/index.ts";

/** Una vida como era en `tick`; la pone quien tiene el guardado (la sesión). */
export type PastLife = (tick: Tick) => Life;

export function replayLifeAt(
  content: Content,
  input: ReplayInput<LifeSetup, Parameters<Life["submit"]>[0]>,
  tick: Tick,
): Life {
  const life = Life.create(input.seed, content, optionsOf(input.setup));
  if (tick < life.now) {
    throw new RangeError(`la vida empieza en t${life.now}: no hay estado antes`);
  }
  const ticks = [...new Set(input.plans.map((p) => p.tick).filter((t) => t < tick))].sort(
    (a, b) => a - b,
  );
  for (const t of ticks) {
    life.advanceTo(t);
    for (const p of input.plans) if (p.tick === t) life.submit(p.plan, p.seq);
  }
  life.advanceTo(tick);
  return life;
}
