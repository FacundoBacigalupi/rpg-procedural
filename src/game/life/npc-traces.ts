// Rastros en el camino (travel §3, perception: huellas, npc-b2b4b): quien viaja deja señales físicas
// en los hexes que pisa (`NPC_TRAIL`: dónde estuvo y cuántas horas) y quien pasa después por el mismo
// hex puede notarlas. Lo que nota es una creencia (`NPC_TRACES`): qué cree haber visto (huellas, restos
// de fogata) y hace cuánto, con error; nunca de quién. Una sola mirada por rastro y viajero. Se nota
// con una tirada con rng propio. Opt-in (`LifeParts.npcTraces`, con `npcEncounters`).

import {
  type AgentId,
  externalAccount,
  holderAccount,
  ledgerUnit,
  makeId,
  type PlaceRef,
} from "../../core/index.ts";
import {
  BODY_STATE,
  deleteComponent,
  draftEvent,
  EATEN,
  ECOLOGY,
  ENTITY,
  type EventDraft,
  LOCATION,
  type PostingDraft,
  type ProcessDef,
  type ReadonlyWorldTruth,
  ROTTED,
  setComponent,
  table,
} from "../../sim/index.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";

export const NPC_TRACES_PROCESS = "life.npc_traces";
export const TRACE_SEEN_EVENT = "npc.trace_seen";

export const LOAD_DROPPED_EVENT = "npc.load_dropped";
export const LOAD_FOUND_EVENT = "npc.load_found";
export const LOAD_ROTTED_EVENT = "npc.load_rotted";
export const LOAD_RECLAIMED_EVENT = "npc.load_reclaimed";
export const LOAD_EATEN_EVENT = "npc.load_eaten";
export const LOAD_LEAKED_EVENT = "npc.load_leaked";

/** Por qué se pierde la carga: cada causa sale del estado del viajero y deja un resto distinto. */
export type LossCause = "stumble" | "leak" | "weight";

export type TraceKind = "footprints" | "campfire" | "dropped_load";

/** Por dónde anduvo: una entrada por tramo continuo en un hex. */
export interface TrailStep {
  readonly hex: number;
  /** Cuándo llegó y cuándo se lo vio por última vez ahí (segundos de mundo). */
  readonly from: number;
  readonly last: number;
}
export const NPC_TRAIL = table<{ readonly steps: readonly TrailStep[] }>("life.npc_trail");

/** Carga que el viajero dejó caer en un hex del camino: un lote en la cuenta de la celda. */
export interface DroppedLot {
  readonly hex: number;
  readonly unit: string;
  readonly name: string;
  readonly grams: number;
  readonly at: number;
}
/** Por quien la perdió (origen del lote); lo que quede sin recoger sigue en el ledger de la celda. */
export const NPC_DROPS = table<{ readonly lots: readonly DroppedLot[] }>("life.npc_drops");

/** Lo que el viajero cree haber visto: sin quién, con la edad estimada (no la real). */
export interface BelievedTrace {
  readonly hex: number;
  readonly kind: TraceKind;
  readonly estAgeHours: number;
  readonly at: number;
}
export const NPC_TRACES = table<{
  readonly since: number;
  /** Rastros ya mirados (`hex:from`), notados o no. */
  readonly looked: readonly string[];
  readonly seen: readonly BelievedTrace[];
}>("life.npc_traces");

/** Cuánto dura un rastro en el camino. */
export const TRAIL_KEEP_HOURS = 72;
/** Horas seguidas en un hex para que cuente como campamento (resto de fogata). */
export const CAMP_HOURS = 5;
/** Chance de notar un rastro al pasar. */
export const NOTICE_CHANCE = 0.5;
/** Error relativo (desvío estándar) de la edad estimada. */
export const AGE_SD = 0.3;
/** Tope de rastros que guarda y de miradas que recuerda por viaje. */
export const MAX_SEEN = 8;
export const MAX_LOOKED = 32;
/** Rastros mirados por pasada. */
export const MAX_NOTICED_PER_PASS = 2;
/** Chance por hora de camino de perder carga, y fracción del bolsillo que se cae (sin calibrar). */
export const DROP_CHANCE = 0.01;
export const DROP_FRACTION = 0.15;
/** Chance de recoger lo que vio caído (hallazgo: lo tirado en el camino es de quien lo toma). */
export const PICKUP_CHANCE = 0.7;
export const MAX_DROPS = 4;
/** Chance por hora de que el dueño que está en el hex reclame lo que dejó caer (sin calibrar). */
export const RECLAIM_CHANCE = 0.9;

/** Chance por hora y por animal de la población de que algo se coma lo caído (sin calibrar). */
export const SCAVENGE_RATE = 0.002;
/** Gramos que come cada animal por vez y tope de animales que comen a la vez. */
export const SCAVENGE_GRAMS_EACH = 20;
export const SCAVENGE_MAX_ANIMALS = 20;

/** Tropiezo: desde esta fatiga (0-1) el cansancio sube la chance por hora (sin calibrar). */
export const STUMBLE_AT = 0.5;
export const STUMBLE_CHANCE = 0.03;
/** Peso: desde estos gramos en el bolsillo se rompe la correa y cae más (sin calibrar). */
export const HEAVY_GRAMS = 4000;
export const WEIGHT_CHANCE = 0.02;
export const WEIGHT_FRACTION = 0.3;
/** Fuga de un odre (bien líquido): chance por hora y fracción que se pierde sin dejar nada que hallar. */
export const LEAK_CHANCE = 0.015;
export const LEAK_FRACTION = 0.1;

const HOUR = 3600;

export function traceKind(step: TrailStep): TraceKind {
  return step.last - step.from >= CAMP_HOURS * HOUR ? "campfire" : "footprints";
}

export interface NpcTracesOptions {
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Opt-in: el bien que lleva en el bolsillo (`provisions`) y puede perder o recoger en el camino. */
  readonly load?: {
    /** Opt-in: el dueño que vuelve al hex reclama lo suyo y tiene la prioridad sobre quien lo halle. */
    readonly reclaim?: boolean;
    readonly unit: string;
    readonly name: string;
    /** Opt-in: la pérdida tiene causa (tropiezo con fatiga, peso, fuga si `liquid`) con efecto distinto sobre lo caído; apagado, la pérdida de siempre. */
    readonly causes?: { readonly liquid?: boolean };
    /** Opt-in: horas que aguanta lo caído; pasadas, se pudre (sumidero `rotted`) y el registro caduca. */
    readonly rotAfterHours?: number;
    /** Opt-in: un linaje de `ECOLOGY` (los animales que de verdad hay en la celda) se come lo caído en `hexes` (default todos); la chance sale de cuántos son. */
    readonly scavenge?: { readonly lineage: string; readonly hexes?: readonly number[] };
  };
}

/** Qué causa pierde la carga esta hora, si alguna; una tirada propia por causa, en orden fijo. */
export function lossCause(
  pocketGrams: number,
  fatigue: number,
  liquid: boolean,
  roll: (name: string) => number,
): LossCause | undefined {
  if (!(pocketGrams > 0)) return undefined;
  if (liquid && roll("leak") < LEAK_CHANCE) return "leak";
  if (pocketGrams >= HEAVY_GRAMS && roll("weight") < WEIGHT_CHANCE) return "weight";
  if (fatigue > STUMBLE_AT) {
    const over = (Math.min(1, fatigue) - STUMBLE_AT) / (1 - STUMBLE_AT);
    if (roll("stumble") < STUMBLE_CHANCE * over) return "stumble";
  }
  return undefined;
}

/** La cuenta del ledger donde queda lo caído en un hex. */
export function roadAccount(hex: number) {
  return holderAccount({ kind: "cell", cell: makeId("cell", hex) });
}

export function npcTracesProcess(o: NpcTracesOptions): ProcessDef {
  return {
    id: NPC_TRACES_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "perceive",
    reads: [
      ENTITY.name,
      LOCATION.name,
      NPC_JOURNEY.name,
      NPC_TRAIL.name,
      NPC_TRACES.name,
      NPC_DROPS.name,
      ...(o.load?.scavenge ? [ECOLOGY.name] : []),
      ...(o.load?.causes ? [BODY_STATE.name] : []),
    ],
    writes: [NPC_TRAIL.name, NPC_TRACES.name, NPC_DROPS.name],
    scopeGuard: (truth, scope) =>
      truth.get(NPC_JOURNEY, scope as AgentId) !== undefined ||
      truth.get(NPC_TRAIL, scope as AgentId) !== undefined ||
      truth.get(NPC_TRACES, scope as AgentId) !== undefined ||
      ((o.load?.rotAfterHours !== undefined ||
        o.load?.reclaim === true ||
        o.load?.scavenge !== undefined) &&
        truth.get(NPC_DROPS, scope as AgentId) !== undefined),
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      const now = ctx.now;
      // Lo caído que nadie recogió se pudre: sale de la celda al sumidero y el registro caduca.
      const rotHours = o.load?.rotAfterHours;
      const allDrops = truth.get(NPC_DROPS, me)?.lots ?? [];
      const rotting =
        rotHours === undefined || !ctx.ledger
          ? []
          : allDrops.filter((l) => now - l.at >= rotHours * HOUR);
      const liveDrops =
        rotting.length > 0 ? allDrops.filter((l) => !rotting.includes(l)) : allDrops;
      const rotChanges = [];
      const rotEvents: EventDraft[] = [];
      const rotPostings: PostingDraft[] = [];
      if (rotting.length > 0 && ctx.ledger) {
        const left = new Map<string, number>();
        for (const lot of rotting) {
          const acct = roadAccount(lot.hex);
          const unit = ledgerUnit(lot.unit);
          const k = `${lot.hex}:${lot.unit}`;
          const have = left.get(k) ?? ctx.ledger.balance(acct, unit);
          const grams = Math.min(lot.grams, have);
          left.set(k, have - grams);
          if (grams <= 0) continue;
          rotEvents.push({
            kind: LOAD_ROTTED_EVENT,
            actors: [me],
            place: o.placeOf(truth, me),
            data: { hex: lot.hex, unit: lot.unit, grams },
            emissions: {},
            causes: [{ kind: "state", entity: me, key: "life.npc_drops" }],
          });
          rotPostings.push({
            event: draftEvent(rotEvents.length - 1),
            transfers: [{ unit, from: acct, to: externalAccount(ROTTED), amount: grams }],
          });
        }
      }
      // Un animal que de verdad vive en la celda se come lo caído: sumidero `eaten`, causa en la ecología.
      let afterEat = liveDrops;
      const sc = o.load?.scavenge;
      const eco = sc && ctx.ledger ? truth.ids(ECOLOGY)[0] : undefined;
      if (sc && eco !== undefined && ctx.ledger && liveDrops.length > 0) {
        const count = truth
          .get(ECOLOGY, eco)
          ?.cell.populations.find((p) => p.lineage === sc.lineage)?.count;
        const animals = Math.min(SCAVENGE_MAX_ANIMALS, Math.floor(count ?? 0));
        if (animals > 0) {
          const chance = 1 - (1 - SCAVENGE_RATE) ** animals;
          const roll = ctx.rng.fork("scavenge", me, now);
          const here = truth.get(LOCATION, me)?.hex;
          const left = new Map<string, number>();
          const rest: DroppedLot[] = [];
          for (const lot of liveDrops) {
            const guarded = o.load?.reclaim === true && here === lot.hex;
            const roams = sc.hexes === undefined || sc.hexes.includes(lot.hex);
            if (guarded || !roams || roll.float() >= chance) {
              rest.push(lot);
              continue;
            }
            const acct = roadAccount(lot.hex);
            const unit = ledgerUnit(lot.unit);
            const k = `${lot.hex}:${lot.unit}`;
            const have = left.get(k) ?? ctx.ledger.balance(acct, unit);
            const grams = Math.min(lot.grams, have, animals * SCAVENGE_GRAMS_EACH);
            left.set(k, have - grams);
            if (grams <= 0) continue;
            if (lot.grams > grams) rest.push({ ...lot, grams: lot.grams - grams });
            rotEvents.push({
              kind: LOAD_EATEN_EVENT,
              actors: [me],
              place: o.placeOf(truth, me),
              data: { hex: lot.hex, unit: lot.unit, grams, lineage: sc.lineage },
              emissions: {},
              causes: [{ kind: "state", entity: eco, key: "living.ecology" }],
            });
            rotPostings.push({
              event: draftEvent(rotEvents.length - 1),
              transfers: [{ unit, from: acct, to: externalAccount(EATEN), amount: grams }],
            });
          }
          if (rotEvents.some((e) => e.kind === LOAD_EATEN_EVENT)) afterEat = rest;
        }
      }
      if (afterEat !== liveDrops || rotting.length > 0) {
        rotChanges.push(
          afterEat.length > 0
            ? setComponent(NPC_DROPS, me, { lots: afterEat })
            : deleteComponent(NPC_DROPS, me),
        );
      }
      if (me === o.player || truth.get(ENTITY, me)?.endedAt !== undefined) {
        return rotChanges.length > 0 || rotEvents.length > 0
          ? {
              changes: rotChanges,
              events: rotEvents,
              ...(rotPostings.length > 0 ? { postings: rotPostings } : {}),
            }
          : {};
      }
      const trip = truth.get(NPC_JOURNEY, me);
      const here = truth.get(LOCATION, me)?.hex;
      const changes = [...rotChanges];
      const events: EventDraft[] = [...rotEvents];
      const postings: PostingDraft[] = [...rotPostings];
      const load = o.load;
      const pocket = holderAccount(me);
      let kept = afterEat;

      // El dueño que vuelve al hex donde dejó caer su carga la reclama (derecho de quien la perdió).
      if (load?.reclaim && ctx.ledger && here !== undefined) {
        const mine = kept.filter((l) => l.hex === here && l.unit === load.unit);
        if (mine.length > 0 && ctx.rng.fork("reclaim", me, now).float() < RECLAIM_CHANCE) {
          const unit = ledgerUnit(load.unit);
          let have = ctx.ledger.balance(roadAccount(here), unit);
          for (const lot of mine) {
            const grams = Math.min(lot.grams, have);
            have -= grams;
            if (grams <= 0) continue;
            events.push({
              kind: LOAD_RECLAIMED_EVENT,
              actors: [me],
              place: o.placeOf(truth, me),
              data: { hex: here, unit: load.unit, grams },
              emissions: {},
              causes: [{ kind: "state", entity: me, key: "life.npc_drops" }],
            });
            postings.push({
              event: draftEvent(events.length - 1),
              transfers: [{ unit, from: roadAccount(here), to: pocket, amount: grams }],
            });
          }
          kept = kept.filter((l) => !mine.includes(l));
          changes.push(
            kept.length > 0
              ? setComponent(NPC_DROPS, me, { lots: kept })
              : deleteComponent(NPC_DROPS, me),
          );
        }
      }

      // Lo que deja: el tramo en este hex; lo viejo se olvida.
      const old = truth.get(NPC_TRAIL, me)?.steps ?? [];
      let steps = old.filter((s) => now - s.last <= TRAIL_KEEP_HOURS * HOUR);
      if (trip && here !== undefined) {
        const tail = steps[steps.length - 1];
        steps =
          tail && tail.hex === here
            ? [...steps.slice(0, -1), { ...tail, last: now }]
            : [...steps, { hex: here, from: now, last: now }];
      }
      if (steps.length !== old.length || steps.some((s, i) => s !== old[i])) {
        changes.push(
          steps.length > 0
            ? setComponent(NPC_TRAIL, me, { steps })
            : deleteComponent(NPC_TRAIL, me),
        );
      }

      // Lo que nota: rastros de otros en este hex, ya sin ellos.
      const book = truth.get(NPC_TRACES, me);
      if (!trip) {
        if (book) changes.push(deleteComponent(NPC_TRACES, me));
      } else if (here !== undefined) {
        const fresh = book !== undefined && book.since === trip.since;
        const looked = new Set(fresh ? book.looked : []);
        const seen = [...(fresh ? book.seen : [])];
        const candidates: { key: string; step: TrailStep }[] = [];
        for (const other of truth.ids(NPC_TRAIL) as AgentId[]) {
          if (other === me || truth.get(LOCATION, other)?.hex === here) continue;
          for (const s of truth.get(NPC_TRAIL, other)?.steps ?? []) {
            const key = `${s.hex}:${s.from}`;
            if (s.hex === here && now - s.last >= 2 * HOUR && !looked.has(key)) {
              candidates.push({ key, step: s });
            }
          }
        }
        candidates.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        for (const { key, step } of candidates.slice(0, MAX_NOTICED_PER_PASS)) {
          looked.add(key);
          const roll = ctx.rng.fork("trace", me, key);
          if (roll.float() >= NOTICE_CHANCE) continue;
          const realHours = (now - step.last) / HOUR;
          const estAgeHours = Math.max(1, Math.round(realHours * (1 + roll.normal(0, AGE_SD))));
          const kind = traceKind(step);
          seen.push({ hex: here, kind, estAgeHours, at: now });
          events.push({
            kind: TRACE_SEEN_EVENT,
            actors: [me],
            place: o.placeOf(truth, me),
            data: { hex: here, trace: kind, estAgeHours },
            emissions: {},
            causes: [{ kind: "state", entity: me, key: "location" }],
          });
        }
        // Carga caída: la ve (creencia) y, si quiere, la recoge del ledger de la celda.
        let lookedDrop = false;
        if (load && ctx.ledger) {
          const unit = ledgerUnit(load.unit);
          const lying: { owner: AgentId; lot: DroppedLot }[] = [];
          for (const owner of truth.ids(NPC_DROPS) as AgentId[]) {
            if (owner === me) continue;
            // Si el dueño está en el hex, la prioridad es suya.
            if (load.reclaim && truth.get(LOCATION, owner)?.hex === here) continue;
            for (const lot of truth.get(NPC_DROPS, owner)?.lots ?? []) {
              if (rotHours !== undefined && now - lot.at >= rotHours * HOUR) continue;
              if (lot.hex === here && lot.unit === load.unit) lying.push({ owner, lot });
            }
          }
          lying.sort((a, b) =>
            a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : a.lot.at - b.lot.at,
          );
          for (const { owner, lot } of lying) {
            const key = `drop:${lot.hex}:${lot.at}:${lot.grams}`;
            if (looked.has(key)) continue;
            looked.add(key);
            lookedDrop = true;
            const roll = ctx.rng.fork("drop_seen", me, key);
            if (roll.float() >= NOTICE_CHANCE) continue;
            const estAgeHours = Math.max(
              1,
              Math.round(((now - lot.at) / HOUR) * (1 + roll.normal(0, AGE_SD))),
            );
            seen.push({ hex: here, kind: "dropped_load", estAgeHours, at: now });
            events.push({
              kind: TRACE_SEEN_EVENT,
              actors: [me],
              place: o.placeOf(truth, me),
              data: { hex: here, trace: "dropped_load", estAgeHours },
              emissions: {},
              causes: [{ kind: "state", entity: me, key: "location" }],
            });
            if (roll.float() >= PICKUP_CHANCE) continue;
            const grams = Math.min(lot.grams, ctx.ledger.balance(roadAccount(here), unit));
            const rest = (truth.get(NPC_DROPS, owner)?.lots ?? []).filter((l) => l !== lot);
            changes.push(
              rest.length > 0
                ? setComponent(NPC_DROPS, owner, { lots: rest })
                : deleteComponent(NPC_DROPS, owner),
            );
            if (grams <= 0) continue;
            events.push({
              kind: LOAD_FOUND_EVENT,
              actors: [me],
              place: o.placeOf(truth, me),
              data: { hex: here, unit: load.unit, grams },
              emissions: {},
              causes: [{ kind: "state", entity: owner, key: "life.npc_drops" }],
            });
            postings.push({
              event: draftEvent(events.length - 1),
              transfers: [{ unit, from: roadAccount(here), to: pocket, amount: grams }],
            });
            break;
          }
        }
        if (candidates.length > 0 || lookedDrop || (book && !fresh)) {
          changes.push(
            setComponent(NPC_TRACES, me, {
              since: trip.since,
              looked: [...looked].sort().slice(-MAX_LOOKED),
              seen: seen.slice(-MAX_SEEN),
            }),
          );
        }
      }

      // Lo que pierde: parte del bolsillo cae en este hex y queda a la vista de quien pase.
      if (load && ctx.ledger && trip && here !== undefined) {
        const unit = ledgerUnit(load.unit);
        const have = ctx.ledger.balance(pocket, unit);
        const cause: LossCause | "plain" | undefined = load.causes
          ? lossCause(
              have,
              truth.get(BODY_STATE, me)?.fatigue ?? 0,
              load.causes.liquid === true,
              (name) => ctx.rng.fork(name, me, now).float(),
            )
          : have > 0 && ctx.rng.fork("drop", me, now).float() < DROP_CHANCE
            ? "plain"
            : undefined;
        const fraction =
          cause === "weight" ? WEIGHT_FRACTION : cause === "leak" ? LEAK_FRACTION : DROP_FRACTION;
        const grams = Math.floor(have * fraction);
        if (cause === "leak" && grams > 0) {
          // Se derrama: no queda nada en el camino que hallar, sale del ledger al sumidero.
          events.push({
            kind: LOAD_LEAKED_EVENT,
            actors: [me],
            place: o.placeOf(truth, me),
            data: { hex: here, unit: load.unit, grams, cause },
            emissions: {},
            causes: [{ kind: "state", entity: me, key: "location" }],
          });
          postings.push({
            event: draftEvent(events.length - 1),
            transfers: [{ unit, from: pocket, to: externalAccount(ROTTED), amount: grams }],
          });
        } else if (cause !== undefined && cause !== "leak" && grams > 0) {
          const lots = [
            ...kept,
            { hex: here, unit: load.unit, name: load.name, grams, at: now },
          ].slice(-MAX_DROPS);
          changes.push(setComponent(NPC_DROPS, me, { lots }));
          events.push({
            kind: LOAD_DROPPED_EVENT,
            actors: [me],
            place: o.placeOf(truth, me),
            data: {
              hex: here,
              unit: load.unit,
              grams,
              ...(cause === "plain" ? {} : { cause }),
            },
            emissions: {},
            causes: [{ kind: "state", entity: me, key: "location" }],
          });
          postings.push({
            event: draftEvent(events.length - 1),
            transfers: [{ unit, from: pocket, to: roadAccount(here), amount: grams }],
          });
        }
      }
      return changes.length > 0 || events.length > 0
        ? { changes, events, ...(postings.length > 0 ? { postings } : {}) }
        : {};
    },
  };
}
