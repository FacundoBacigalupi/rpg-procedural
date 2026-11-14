// Los duelos acordados (novel3-challenge-ask, combat §13): un desafío aceptado (`combat.challenge`
// con respuesta `accept`, de `life.converse`) queda anotado en `DUEL` de los dos, con la regla y
// hasta cuándo vale. Lo escribe este proceso y no la conversación, que solo escribe en quien oye.
// Los vencidos se borran solos al pasar por acá.

import { type AgentId, compareStrings } from "../../core/index.ts";
import {
  CHALLENGE_EVENT,
  DUEL,
  DUEL_DAYS,
  type Duel,
  type DuelRule,
  deleteComponent,
  type ProcessDef,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export const DUELS_PROCESS = "life.duels";

export function duelsProcess(o: { readonly dayTicks: number }): ProcessDef {
  return {
    id: DUELS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [DUEL.name],
    writes: [DUEL.name],
    run(ctx) {
      const set = new Map<AgentId, Duel>();
      for (const e of ctx.recent) {
        if (e.kind !== CHALLENGE_EVENT) continue;
        const d = e.data as {
          challenger?: AgentId;
          challenged?: AgentId;
          rule?: DuelRule;
          response?: string;
        } | null;
        if (!d || d.response !== "accept" || !d.challenger || !d.challenged || !d.rule) continue;
        const until = e.tick + DUEL_DAYS * o.dayTicks;
        const base = { rule: d.rule, challenger: d.challenger, at: e.tick, until, event: e.id };
        set.set(d.challenger, { ...base, with: d.challenged });
        set.set(d.challenged, { ...base, with: d.challenger });
      }
      const changes: StateChange[] = [];
      for (const id of [...ctx.truth.ids(DUEL)].sort(compareStrings) as AgentId[]) {
        const d = ctx.truth.get(DUEL, id);
        if (d && ctx.now > d.until && !set.has(id)) changes.push(deleteComponent(DUEL, id));
      }
      for (const [id, d] of [...set].sort(([a], [b]) => compareStrings(a, b))) {
        changes.push(setComponent(DUEL, id, d));
      }
      return changes.length === 0 ? {} : { changes };
    },
  };
}
