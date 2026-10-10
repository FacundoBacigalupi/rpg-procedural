// Lo que la aldea se entera de un robo o una pelea (law §2, §15; Fase 1: «testigos que vieron, la
// víctima reclama, la aldea se entera»). Al cerrar cada paso, los vecinos que estaban ahí
// perciben el hecho con sus sentidos (perception) y guardan lo que alcanzaron a ver y a quién
// reconocieron; los que lo saben se lo cuentan a su casa. Un hecho que nadie percibió no existe
// para nadie (el caso nace de una creencia) y no hay quién reclame. Las peleas además dejan
// sangre en el lugar (huella), que se borra sola con las horas.

import type { AgentId, Event, PlanetClock, Rng, Seed, Tick } from "../../core/index.ts";
import {
  ATTENTION,
  actionStimulus,
  attireLook,
  BODY_STATE,
  bloodStrength,
  CREDIT,
  clearDefault,
  createEntity,
  type Deed,
  type DeedKind,
  type DeedRead,
  type DeedVia,
  ENTITY,
  INNATE,
  KNOWN_DEEDS,
  LOCATION,
  type LocalMap,
  learnDeed,
  localHour,
  MIND,
  type Observer,
  PERSON,
  type ProcessDef,
  perceive,
  purposeWeight,
  RELATIONS,
  type ReadonlyWorldTruth,
  type SpaceGraph,
  STATUS,
  type StateChange,
  type StatusDef,
  sensorAcuity,
  setComponent,
  skyLight,
  TRACE,
} from "../../sim/index.ts";
import { settledIn } from "./credit.ts";
import { ASCRIBED_GROUPS } from "./identity.ts";
import { PURPOSE_READS, type ReaderContent, readWitnessed } from "./reading.ts";

export const DEEDS_PROCESS = "life.deeds";

export interface DeedsOptions {
  readonly map: LocalMap;
  readonly spaces: SpaceGraph;
  readonly clock: PlanetClock;
  readonly seed: Seed;
  readonly statuses: readonly StatusDef[];
  /** Con qué se arma al lector al leer el porqué de un hecho (sin esto, sin aprecio por el actor). */
  readonly relations?: ReaderContent;
}

const KNOWN_HOUSEHOLD = 0.95;
const KNOWN_VILLAGER = 0.8;

function alive(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return truth.get(ENTITY, id)?.endedAt === undefined;
}

/** Un vecino como observador: dormido casi no se entera, trabajando está absorto. */
function neighbor(
  truth: ReadonlyWorldTruth,
  o: DeedsOptions,
  id: AgentId,
  now: Tick,
  everyone: readonly AgentId[],
): Observer | null {
  const me = truth.get(PERSON, id);
  const at = truth.get(LOCATION, id);
  if (!me || !at) return null;
  const activity = truth.get(BODY_STATE, id)?.activity;
  const attention =
    activity === "sleep"
      ? ATTENTION.asleep
      : activity === "heavy" || activity === "moderate"
        ? ATTENTION.absorbed
        : ATTENTION.relaxed;
  const familiar = new Map<AgentId, number>();
  for (const other of everyone) {
    if (other === id) continue;
    const p = truth.get(PERSON, other);
    familiar.set(other, p?.household === me.household ? KNOWN_HOUSEHOLD : KNOWN_VILLAGER);
  }
  return {
    id,
    at,
    acuity: sensorAcuity((now - me.born) / o.clock.year),
    attention,
    familiar,
  };
}

/** Lo que el evento es, si es un delito: qué, quién lo hizo y contra quién. */
export function offenseOf(
  e: Event,
): { kind: DeedKind; by: AgentId; victim: AgentId; noticedBy: readonly AgentId[] } | null {
  const [first, second] = e.actors as AgentId[];
  if (!first) return null;
  const data = e.data as {
    effect?: { kind?: string; from?: string; got?: readonly unknown[] };
    noticedBy?: readonly string[];
  } | null;
  if ((e.kind === "combat.fight" || e.kind === "combat.finish") && second) {
    return { kind: "assault", by: first, victim: second, noticedBy: [second] };
  }
  if (e.kind === "law.default" && second) {
    // El acreedor es quien reclama: sabe quién le debe.
    return { kind: "default", by: first, victim: second, noticedBy: [second] };
  }
  if (e.kind === "scam.discovered" && second) {
    // La estafa descubierta es fe rota: se anota como incumplimiento (el comprador sabe quién fue).
    return { kind: "default", by: first, victim: second, noticedBy: [second] };
  }
  if (e.kind === "contract.pledge_broken" && second) {
    // La promesa rota es un incumplimiento más: el destinatario sabe quién le falló.
    return { kind: "default", by: first, victim: second, noticedBy: [second] };
  }
  const eff = data?.effect;
  if (e.kind === "action.take" && eff?.kind === "take" && (eff.got?.length ?? 0) > 0) {
    const from = eff.from;
    // Agarrar lo que lleva otra persona encima es robarle; lo del suelo o del lugar no.
    if (from?.startsWith("agent:") && from !== first) {
      const caught = (data?.noticedBy ?? []).filter((c) => c === from) as AgentId[];
      return { kind: "theft", by: first, victim: from as AgentId, noticedBy: caught };
    }
  }
  return null;
}

/** Quiénes se enteran de `e` y en qué grado: `by` es null si lo vieron pero no lo reconocieron. */
function witnessesOf(
  truth: ReadonlyWorldTruth,
  o: DeedsOptions,
  e: Event,
  off: NonNullable<ReturnType<typeof offenseOf>>,
  everyone: readonly AgentId[],
  rng: Rng,
): { who: AgentId; by: AgentId | null; via: DeedVia }[] {
  const at = truth.get(LOCATION, off.by);
  const p = truth.get(PERSON, off.by);
  if (!at || !p) return [];
  const em = (e.emissions ?? {}) as { sight?: number; sound?: number };
  const observers = everyone
    .filter((id) => id !== off.by && alive(truth, id))
    .flatMap((id) => {
      const ob = neighbor(truth, o, id, e.tick, everyone);
      return ob ? [ob] : [];
    });
  const seen = perceive(
    actionStimulus({
      event: e.id,
      tick: e.tick,
      actor: off.by,
      at,
      look: {
        sex: p.sex,
        ageYears: (e.tick - p.born) / o.clock.year,
        ...attireLook(truth.get(STATUS, off.by), o.statuses),
      },
      verb: e.kind,
      emissions: { sight: em.sight ?? 0, sound: em.sound ?? 0 },
    }),
    observers,
    {
      graph: o.spaces,
      forest: o.map.forest,
      daylight: skyLight(o.map, o.clock, o.seed, e.tick),
    },
    rng.fork(e.id),
  );
  const out = new Map<AgentId, { by: AgentId | null; via: DeedVia }>();
  for (const pc of seen) {
    if (pc.detail === "vague") continue; // un ruido no es haber visto un delito
    out.set(pc.observer, {
      by: pc.detail === "identified" ? off.by : null,
      via: pc.channels.includes("sight") ? "saw" : "heard",
    });
  }
  // Quien lo agarró con la mano adentro, o con quien se peleó, sabe quién fue.
  for (const id of off.noticedBy) if (alive(truth, id)) out.set(id, { by: off.by, via: "saw" });
  return [...out].map(([who, k]) => ({ who, ...k }));
}

/**
 * Lo que `witness` leyó del porqué del actor (actions, `readPurpose`), como peso para juzgar el hecho
 * (law §6): la lectura ya guardada en `PURPOSE_READS` si es la de este evento, o la que arma ahora con
 * su sospecha y su aprecio. Sin porqué en el evento no hay lectura y se juzga por el hecho solo.
 */
function readOf(
  truth: ReadonlyWorldTruth,
  o: DeedsOptions,
  e: Event,
  witness: AgentId,
  rng: Rng,
): DeedRead | undefined {
  const stored = truth
    .get(PURPOSE_READS, witness)
    ?.recent.find((r) => r.actor === e.actors[0] && r.tick === e.tick);
  const read =
    stored ?? readWitnessed(rng.fork("deedread", e.id, witness), truth, witness, e, o.relations);
  return read === undefined ? undefined : { weight: Math.round(purposeWeight(read) * 1000) / 1000 };
}

export function deedsProcess(o: DeedsOptions): ProcessDef {
  return {
    id: DEEDS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      KNOWN_DEEDS.name,
      CREDIT.name,
      PERSON.name,
      LOCATION.name,
      ENTITY.name,
      BODY_STATE.name,
      STATUS.name,
      PURPOSE_READS.name,
      MIND.name,
      INNATE.name,
      RELATIONS.name,
      "culture.person",
      "culture.community",
      ASCRIBED_GROUPS.name,
    ],
    writes: [KNOWN_DEEDS.name, TRACE.name, ENTITY.name],
    run(ctx) {
      const truth = ctx.truth;
      const everyone = truth
        .ids(PERSON)
        .map((id) => id as AgentId)
        .filter((id) => alive(truth, id));
      // Lo que cada uno sabe después de este paso (varios hechos pueden sumarse al mismo).
      const knows = new Map<AgentId, ReturnType<typeof learnDeed>>();
      const learn = (id: AgentId, deed: Deed) => {
        const before = knows.get(id) ?? truth.get(KNOWN_DEEDS, id);
        const after = learnDeed(before, deed);
        if (after !== before) knows.set(id, after);
      };
      const changes: StateChange[] = [];
      for (const e of ctx.recent) {
        const off = offenseOf(e);
        if (!off) continue;
        // Lo que se toma dentro de la casa es de la familia, no un robo.
        const home = (id: AgentId) => truth.get(PERSON, id)?.household;
        if (off.kind === "theft" && home(off.by) === home(off.victim)) continue;
        const base = { kind: off.kind, victim: off.victim, event: e.id, at: e.tick };
        const witnesses = witnessesOf(truth, o, e, off, everyone, ctx.rng);
        for (const w of witnesses) {
          const read = w.by === null ? undefined : readOf(truth, o, e, w.who, ctx.rng);
          learn(w.who, { ...base, by: w.by, via: w.via, ...(read ? { read } : {}) });
        }
        // Los que saben quién fue se lo cuentan a su casa.
        for (const w of witnesses.filter((x) => x.by !== null)) {
          for (const kin of everyone) {
            if (kin === w.who || home(kin) !== home(w.who)) continue;
            learn(kin, { ...base, by: w.by, via: "told" });
          }
        }
        if (e.kind === "combat.fight") {
          const hits =
            (e.data as { hits?: readonly { severity?: number }[] } | null)?.hits?.filter(
              (h) => (h.severity ?? 0) > 0,
            ) ?? [];
          const at = truth.get(LOCATION, off.by);
          if (hits.length > 0 && at) {
            const id = ctx.newId("trace");
            const worst = Math.max(...hits.map((h) => h.severity ?? 0));
            changes.push(
              createEntity(id, e.id, e.tick),
              setComponent(TRACE, id, {
                kind: "blood",
                at,
                made: e.tick,
                by: [off.by, off.victim],
                event: e.id,
                strength: bloodStrength(worst),
              }),
            );
          }
        }
      }
      // Quien salda deja de ser «el que no paga» para todos los que lo sabían (credit.ts).
      const settled = settledIn(truth, ctx.recent, o.clock.day);
      if (settled.length > 0) {
        for (const id of truth.ids(KNOWN_DEEDS)) {
          const before = knows.get(id as AgentId) ?? truth.get(KNOWN_DEEDS, id);
          let kept = before;
          for (const r of settled) kept = clearDefault(kept, r.credit.debtor, r.credit.creditor);
          if (kept && kept !== before) knows.set(id as AgentId, kept);
        }
      }
      for (const [id, value] of knows) changes.push(setComponent(KNOWN_DEEDS, id, value));
      return changes.length === 0 ? {} : { changes };
    },
  };
}
