// Los vivos de la verdad: las entidades `agent:` sin fin. Vive aparte para que lo lean los
// procesos y las presiones sin depender de cómo se arma el mundo (world.ts).

import type { AgentId } from "../../core/index.ts";
import { ENTITY, type ReadonlyWorldTruth } from "../../sim/index.ts";

export function living(truth: ReadonlyWorldTruth): AgentId[] {
  return truth
    .ids(ENTITY)
    .filter(
      (id): id is AgentId =>
        id.startsWith("agent:") && truth.get(ENTITY, id)?.endedAt === undefined,
    );
}
