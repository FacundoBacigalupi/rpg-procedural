// Intrigas F1b-1 (schemes §1, §2, §8): el módulo puro `sim/schemes` cableado a la vida. Cada
// `SchemeSeed` es un objetivo que ya tiene un hecho que lo motiva (`origin`); cuando llega su día,
// el intrigante lo mide con `decideScheme` sobre lo que cree (`view`) y deja una entidad `scheme:n`
// con `SCHEMES` (también si no tramó: queda `abandoned` y no se vuelve a decidir). Cada día de
// mundo avanza un paso con un evento `scheme.step` cuyas causas son `stepCauses`; el id del evento
// se anota al día siguiente leyéndolo de `ctx.recent`. Los pasos todavía no mueven ni hieren a
// nadie (F1b-2: `move`/`attack`/`take`, dinero y huellas para el `Case`). Opt-in
// (`LifeParts.schemes`); apagado no existe ni corre. Nada de esto llega al narrador.

import {
  type AgentId,
  type EventId,
  type HolderRef,
  holderAccount,
  type LedgerAccount,
  type LedgerUnit,
  type PlaceRef,
  type Transfer,
} from "../../core/index.ts";
import {
  BODY_STATE,
  type BodyPlanDef,
  decideScheme,
  draftEvent,
  ENTITY,
  type EventDraft,
  endScheme,
  LOCATION,
  makeScheme,
  nextStep,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  type ReadonlyWorldTruth,
  recordStep,
  type Scheme,
  type SchemeMotive,
  type SchemerView,
  SKILL_STATE,
  type SkillCatalog,
  type StateChange,
  setComponent,
  stepCauses,
  type Trait,
  table,
  YIELDED,
} from "../../sim/index.ts";
import { canFight, FIGHT_STATE, strikeFight } from "./fight.ts";

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

/**
 * Opt-in (F1b-2b): el paso `take` mueve dinero del blanco al intrigante por el ledger (conserva;
 * no se crea nada). Se lleva `fraction` de lo que el blanco tiene en `unit` (redondeado hacia abajo,
 * nunca más que su saldo). Sin esto el paso `take` sigue sin mover nada.
 */
export interface SchemeLoot {
  readonly unit: LedgerUnit;
  /** Parte (0-1) del saldo del blanco que se lleva. */
  readonly fraction: number;
  /** Cuenta de una persona; por defecto, la de su hogar. */
  readonly account?: (truth: ReadonlyWorldTruth, who: AgentId) => LedgerAccount;
}

/**
 * Opt-in (F1b-2b-2): los pasos del plan hacen lo mismo que las acciones normales. `approach` y
 * `flee` son un `move` (cambian el `LOCATION` del intrigante: al lugar del blanco / a `fleeTo`);
 * `strike` es un `attack`: una pelea real (`strikeFight`, heridas por `combat`) del intrigante
 * contra el blanco. Sin esto los pasos siguen sin mover ni herir a nadie.
 */
export interface SchemeActs {
  /** Mover al intrigante en `approach` (al lugar del blanco) y `flee` (a `fleeTo`, si hay). */
  readonly move?: boolean;
  /** Adonde huye tras el golpe; sin esto `flee` no mueve a nadie. */
  readonly fleeTo?: (
    truth: ReadonlyWorldTruth,
    who: AgentId,
  ) => { hex: number; space?: string } | undefined;
  /** El golpe como pelea real. */
  readonly strike?: {
    readonly plans: ReadonlyMap<string, BodyPlanDef>;
    readonly skills: SkillCatalog;
    readonly traits: readonly Trait[];
    readonly light: number;
  };
}

/**
 * Opt-in (F1b-2b-3): lo que el robo deja a la vista. El paso `take` que se llevó algo emite estas
 * intensidades de vista y sonido (0-1), así que los vecinos del lugar lo perciben y `life.deeds`
 * lo anota como robo (los que no reconocen al ladrón saben que hubo uno). Sin esto el paso no
 * emite nada: nadie lo ve y no hay caso.
 */
export interface SchemeTraces {
  readonly sight: number;
  readonly sound: number;
}

export interface SchemesOptions {
  readonly seeds: readonly SchemeSeed[];
  /** Lo que el intrigante cree y es respecto del blanco (nunca la verdad del blanco). */
  readonly view: (truth: ReadonlyWorldTruth, seed: SchemeSeed, now: number) => SchemerView;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Ticks por día de mundo. */
  readonly day: number;
  readonly loot?: SchemeLoot;
  readonly acts?: SchemeActs;
  readonly traces?: SchemeTraces;
}

export function schemeRows(truth: ReadonlyWorldTruth): { id: string; row: SchemeRow }[] {
  return [...truth.ids(SCHEMES)]
    .sort()
    .map((id) => ({ id: id as string, row: truth.get(SCHEMES, id) as SchemeRow }));
}

const householdAccount = (truth: ReadonlyWorldTruth, who: AgentId): LedgerAccount =>
  holderAccount((truth.get(PERSON, who)?.household ?? String(who)) as unknown as HolderRef);

export function schemesProcess(o: SchemesOptions): ProcessDef {
  const acts = o.acts;
  return {
    id: SCHEMES_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [
      SCHEMES.name,
      ENTITY.name,
      PERSON.name,
      ...(acts ? [LOCATION.name, BODY_STATE.name, SKILL_STATE.name] : []),
    ],
    writes: [
      SCHEMES.name,
      ENTITY.name,
      ...(acts?.move ? [LOCATION.name] : []),
      ...(acts?.strike ? [BODY_STATE.name, SKILL_STATE.name, FIGHT_STATE.name, YIELDED.name] : []),
    ],
    run(ctx) {
      const truth = ctx.truth;
      const today = Math.floor(ctx.now / o.day);
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const spent = new Map<string, number>();
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
              let loot: { taken: number; unit: string } | undefined;
              const ledger = ctx.ledger;
              if (o.loot && ledger && step.kind === "take") {
                const acct = o.loot.account ?? householdAccount;
                const from = acct(truth, scheme.target);
                const to = acct(truth, scheme.owner);
                const key = `${String(from)}|${String(o.loot.unit)}`;
                const have =
                  Math.floor(ledger.balance(from, o.loot.unit) ?? 0) - (spent.get(key) ?? 0);
                const taken = Math.max(0, Math.min(have, Math.floor(have * o.loot.fraction)));
                loot = { taken, unit: String(o.loot.unit) };
                if (taken > 0 && String(from) !== String(to)) {
                  const ts: Transfer[] = [{ unit: o.loot.unit, from, to, amount: taken }];
                  postings.push({ event: draftEvent(events.length), transfers: ts });
                  spent.set(key, (spent.get(key) ?? 0) + taken);
                } else loot.taken = 0;
              }
              let acted: Record<string, unknown> | undefined;
              const here = step.kind === "approach" ? scheme.target : scheme.owner;
              if (acts?.move && (step.kind === "approach" || step.kind === "flee")) {
                const to =
                  step.kind === "approach"
                    ? truth.get(LOCATION, scheme.target)
                    : acts.fleeTo?.(truth, scheme.owner);
                const from = truth.get(LOCATION, scheme.owner);
                if (to && from && (to.hex !== from.hex || to.space !== from.space)) {
                  changes.push(
                    setComponent(LOCATION, scheme.owner, {
                      hex: to.hex,
                      ...(to.space !== undefined ? { space: to.space } : {}),
                    } as never),
                  );
                  acted = { moved: true, toHex: to.hex };
                } else acted = { moved: false };
              }
              const fightEvents: EventDraft[] = [];
              if (acts?.strike && step.kind === "strike") {
                const mine = truth.get(BODY_STATE, scheme.owner);
                const cause = draftEvent(events.length);
                if (mine && canFight(truth, scheme.target)) {
                  const f = strikeFight({
                    truth,
                    me: scheme.owner,
                    myBody: mine,
                    target: scheme.target,
                    plans: acts.strike.plans,
                    skills: acts.strike.skills,
                    traits: acts.strike.traits,
                    intent: "kill",
                    light: acts.strike.light,
                    start: ctx.now,
                    rng: ctx.rng.fork("scheme_strike", id, String(scheme.done)),
                    day: o.day,
                    cause,
                    place: o.placeOf(truth, scheme.target),
                  });
                  changes.push(setComponent(BODY_STATE, scheme.owner, f.myBody), ...f.changes);
                  fightEvents.push(f.event);
                  acted = { fought: true, hits: f.gist.woundsDealt };
                } else acted = { fought: false };
              }
              events.push({
                kind: SCHEME_STEP_EVENT,
                actors: [scheme.owner, scheme.target],
                place: o.placeOf(
                  truth,
                  loot || here !== scheme.owner ? scheme.target : scheme.owner,
                ),
                data: {
                  scheme: id,
                  step: scheme.done,
                  stepKind: step.kind,
                  ...(loot ? { taken: loot.taken, unit: loot.unit } : {}),
                  ...(acted ?? {}),
                },
                emissions: o.traces && loot && loot.taken > 0 ? { ...o.traces } : {},
                causes: stepCauses(scheme).map((event) => ({ kind: "event" as const, event })),
              });
              events.push(...fightEvents);
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
        const view = o.view(truth, seed, ctx.now);
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
      return changes.length === 0 && events.length === 0
        ? {}
        : { changes, events, ...(postings.length > 0 ? { postings } : {}) };
    },
  };
}
