// Intrigas F1b-1 (schemes §1, §2, §8): el módulo puro `sim/schemes` cableado a la vida. Cada
// `SchemeSeed` es un objetivo que ya tiene un hecho que lo motiva (`origin`); cuando llega su día,
// el intrigante lo mide con `decideScheme` sobre lo que cree (`view`) y deja una entidad `scheme:n`
// con `SCHEMES` (también si no tramó: queda `abandoned` y no se vuelve a decidir). Cada día de
// mundo avanza un paso con un evento `scheme.step` cuyas causas son `stepCauses`; el id del evento
// se anota al día siguiente leyéndolo de `ctx.recent`. Los pasos todavía no mueven ni hieren a
// nadie (F1b-2: `move`/`attack`/`take`, dinero y huellas para el `Case`). Opt-in
// (`LifeParts.schemes`); apagado no existe ni corre. Nada de esto llega al narrador.

import type { AgentId, EventId, PlaceRef } from "../../core/index.ts";
import {
  decideScheme,
  ENTITY,
  type EventDraft,
  endScheme,
  makeScheme,
  nextStep,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  recordStep,
  type Scheme,
  type SchemeMotive,
  type SchemerView,
  type StateChange,
  setComponent,
  stepCauses,
  table,
} from "../../sim/index.ts";

export const SCHEMES_PROCESS = "life.schemes";
export const SCHEME_STARTED_EVENT = "scheme.started";
export const SCHEME_STEP_EVENT = "scheme.step";
export const SCHEME_DECLINED_EVENT = "scheme.declined";

export interface SchemeSeed {
  /** Clave estable de la semilla (una decisión por clave). */
  readonly key: string;
  readonly owner: AgentId;
  readonly target: AgentId;
  readonly motive: SchemeMotive;
  /** Hecho que lo motiva: causa del plan y `originEventId` de la entidad. */
  readonly origin: EventId;
  readonly startDay: number;
}

export interface SchemeRow {
  readonly key: string;
  readonly scheme: Scheme;
  /** Hay un paso emitido cuyo evento todavía no se anotó en el log. */
  readonly pending: boolean;
}

/** Cada intriga vive en una entidad `scheme:n` con este componente. Solo la escribe `life.schemes`. */
export const SCHEMES = table<SchemeRow>("life.schemes");

export interface SchemesOptions {
  readonly seeds: readonly SchemeSeed[];
  /** Lo que el intrigante cree y es respecto del blanco (nunca la verdad del blanco). */
  readonly view: (truth: ReadonlyWorldTruth, seed: SchemeSeed) => SchemerView;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Ticks por día de mundo. */
  readonly day: number;
}

export function schemeRows(truth: ReadonlyWorldTruth): { id: string; row: SchemeRow }[] {
  return [...truth.ids(SCHEMES)]
    .sort()
    .map((id) => ({ id: id as string, row: truth.get(SCHEMES, id) as SchemeRow }));
}

export function schemesProcess(o: SchemesOptions): ProcessDef {
  return {
    id: SCHEMES_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [SCHEMES.name, ENTITY.name, PERSON.name],
    writes: [SCHEMES.name, ENTITY.name],
    run(ctx) {
      const truth = ctx.truth;
      const today = Math.floor(ctx.now / o.day);
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const known = new Set<string>();

      for (const { id, row } of schemeRows(truth)) {
        known.add(row.key);
        let scheme = row.scheme;
        let pending = row.pending;
        if (pending) {
          const done = scheme.done;
          const hit = ctx.recent.find(
            (e) =>
              e.kind === SCHEME_STEP_EVENT &&
              (e.data as { scheme?: string }).scheme === id &&
              (e.data as { step?: number }).step === done,
          );
          if (hit) {
            scheme = recordStep(scheme, hit.id);
            pending = false;
          }
        }
        if (!pending) {
          const step = nextStep(scheme);
          if (step) {
            if (!alive(scheme.owner) || !alive(scheme.target)) {
              scheme = endScheme(scheme, "abandoned");
            } else {
              events.push({
                kind: SCHEME_STEP_EVENT,
                actors: [scheme.owner, scheme.target],
                place: o.placeOf(truth, scheme.owner),
                data: { scheme: id, step: scheme.done, stepKind: step.kind },
                emissions: {},
                causes: stepCauses(scheme).map((event) => ({ kind: "event" as const, event })),
              });
              pending = true;
            }
          }
        }
        if (scheme !== row.scheme || pending !== row.pending)
          changes.push(setComponent(SCHEMES, id as never, { key: row.key, scheme, pending }));
      }

      for (const seed of [...o.seeds].sort((a, b) => (a.key < b.key ? -1 : 1))) {
        if (known.has(seed.key) || seed.startDay > today) continue;
        if (!alive(seed.owner) || !alive(seed.target)) continue;
        const view = o.view(truth, seed);
        const d = decideScheme(view, ctx.rng.fork("scheme_decide", seed.key));
        const sid = ctx.newId("scheme");
        const base = {
          id: sid,
          owner: seed.owner,
          target: seed.target,
          motive: seed.motive,
          originEventId: seed.origin,
          at: ctx.now,
        };
        const scheme = d.method
          ? makeScheme({ ...base, method: d.method, intellect: view.intellect })
          : endScheme(makeScheme({ ...base, method: "theft", intellect: 0 }), "abandoned");
        changes.push(
          setComponent(
            ENTITY,
            sid as never,
            {
              id: sid,
              originEventId: seed.origin,
              createdAt: ctx.now,
            } as never,
          ),
          setComponent(SCHEMES, sid as never, { key: seed.key, scheme, pending: false }),
        );
        events.push({
          kind: d.method ? SCHEME_STARTED_EVENT : SCHEME_DECLINED_EVENT,
          actors: [seed.owner, seed.target],
          place: o.placeOf(truth, seed.owner),
          data: { scheme: sid, motive: seed.motive, method: d.method, net: d.net },
          emissions: {},
          causes: [{ kind: "event", event: seed.origin }],
        });
      }
      return changes.length === 0 && events.length === 0 ? {} : { changes, events };
    },
  };
}
