// Adivinos de calle en el juego (divination §5, §8, Fase 2). Dos procesos: uno siembra el oficio
// en la aldea (quién lo ejerce sale de edad y temperamento, no de la verdad del futuro) y otro
// atiende las consultas (`divination.consult`: el personaje o un vecino va a ver al adivino). La
// lectura sale de `streetConsult` con un rng forkeado por (adivino, cliente, evento): ritual y
// lectura en frío, sin acceso a la verdad. Lo dicho es una profecía raíz que el adivino cree y que
// le llega al cliente ya contada (`transmit`: se deforma, pierde crédito según la fama del
// adivino), y queda como evento `divination.reading` con la consulta de causa.

import {
  type AgentId,
  type Event,
  type EventId,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type PlanetClock,
  type Rng,
  type Tick,
} from "../../core/index.ts";
import {
  BODY_STATE,
  type Concern,
  type ConcernWords,
  clampTemper,
  concernIn,
  credulity,
  DIVINER_ROLE,
  type DivinationMethodDef,
  type DiviningCandidate,
  divinerSlots,
  ENTITY,
  type EventDraft,
  INNATE,
  isMoney,
  MENTAL,
  PERSON,
  PROPHECY_BELIEFS,
  type ProcessDef,
  type ProphecyBeliefs,
  pickDiviners,
  type ReadonlyLedger,
  type ReadonlyWorldTruth,
  receive,
  renown,
  roleOf,
  type StateChange,
  setComponent,
  streetConsult,
  transmit,
  utter,
} from "../../sim/index.ts";

export const DIVINERS_PROCESS = "life.diviners";
export const CONSULT_PROCESS = "life.consult";
export const CONSULT_EVENT = "divination.consult";
export const READING_EVENT = "divination.reading";
export const TAKE_UP_EVENT = "divination.take_up";

/** Datos de un `divination.consult`: lo que el cliente pregunta y lo que quiere oír. */
export interface ConsultData {
  readonly asked?: Concern;
  /** -1..1: lo que quiere oír (+ lo bueno); sin dato, nada. */
  readonly want?: number;
  /** 0-1 por preocupación: lo que el adivino le ve encima (cojera, bolsa flaca, nervios). */
  readonly signals?: Readonly<Partial<Record<Concern, number>>>;
  /** Lo que dejó en la mano del adivino (el personaje paga; el pago ya pasó por el ledger). */
  readonly paid?: { readonly unit: string; readonly amount: number };
}

export interface DivineOptions {
  readonly methods: readonly DivinationMethodDef[];
  /** Con qué palabras se nombra cada preocupación, para leer lo que el personaje pregunta. */
  readonly concerns: readonly ConcernWords[];
  readonly clock: PlanetClock;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

const byId = <T extends { readonly id: string }>(a: T, b: T) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function livingPeople(truth: ReadonlyWorldTruth): AgentId[] {
  return (truth.ids(PERSON) as AgentId[])
    .filter((id) => truth.get(ENTITY, id)?.endedAt === undefined)
    .sort();
}

function candidateOf(
  truth: ReadonlyWorldTruth,
  id: AgentId,
  now: Tick,
  clock: PlanetClock,
): DiviningCandidate | null {
  const p = truth.get(PERSON, id);
  if (!p) return null;
  const z = truth.get(INNATE, id) ?? {};
  return {
    id,
    ageYears: (now - p.born) / clock.year,
    sociability: clampTemper(z["sociability"] ?? 0),
    curiosity: clampTemper(z["curiosity"] ?? 0),
    warmth: clampTemper(z["warmth"] ?? 0),
    boldness: clampTemper(z["boldness"] ?? 0),
  };
}

/** El método de calle de la cultura que le toca al n-ésimo adivino (reparte entre los rituales). */
function methodFor(
  methods: readonly DivinationMethodDef[],
  n: number,
): DivinationMethodDef | undefined {
  const ritual = methods.filter((m) => m.source === "ritual").sort(byId);
  return ritual[n % Math.max(1, ritual.length)];
}

/** Siembra el oficio: completa los lugares que faltan con quien mejor encaja. */
export function seedDiviners(
  truth: ReadonlyWorldTruth,
  o: DivineOptions,
  now: Tick,
): { changes: StateChange[]; events: EventDraft[] } {
  const people = livingPeople(truth);
  const have = people.filter((id) => truth.get(DIVINER_ROLE, id) !== undefined);
  const missing = divinerSlots(people.length) - have.length;
  if (missing <= 0) return { changes: [], events: [] };
  const free = people
    .filter((id) => !have.includes(id))
    .map((id) => candidateOf(truth, id, now, o.clock))
    .filter((c): c is DiviningCandidate => c !== null);
  const changes: StateChange[] = [];
  const events: EventDraft[] = [];
  let n = have.length;
  for (const id of pickDiviners(free, missing)) {
    const c = free.find((x) => x.id === id) as DiviningCandidate;
    const method = methodFor(o.methods, n++);
    if (!method) break;
    changes.push(setComponent(DIVINER_ROLE, id, roleOf(c, method, now)));
    events.push({
      kind: TAKE_UP_EVENT,
      actors: [id],
      place: o.placeOf(truth, id),
      data: { method: method.id },
      emissions: {},
      causes: [{ kind: "state", entity: id, key: "divination.vocation" }],
    });
  }
  return { changes, events };
}

export function divinersProcess(o: DivineOptions): ProcessDef {
  return {
    id: DIVINERS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, INNATE.name, DIVINER_ROLE.name],
    writes: [DIVINER_ROLE.name],
    run(ctx) {
      const out = seedDiviners(ctx.truth, o, ctx.now);
      return out.changes.length === 0 ? {} : { changes: out.changes, events: out.events };
    },
  };
}

/**
 * La consulta de `client` a `diviner`: tira, lee, interpreta y dice. El adivino se queda con la
 * profecía que dijo (la cree según su convicción) y el cliente con la que le llegó. Sin rol de
 * adivino o con alguno de los dos muerto no pasa nada. `beliefs` deja sumar varias consultas del
 * mismo paso sobre lo que ya se cambió.
 */
export function consultDiviner(
  truth: ReadonlyWorldTruth,
  o: DivineOptions,
  diviner: AgentId,
  client: AgentId,
  data: ConsultData,
  cause: EventId,
  now: Tick,
  rng: Rng,
  beliefs: (who: AgentId) => ProphecyBeliefs | undefined = (who) =>
    truth.get(PROPHECY_BELIEFS, who),
): { changes: StateChange[]; events: EventDraft[] } | null {
  const role = truth.get(DIVINER_ROLE, diviner);
  if (!role) return null;
  if (truth.get(ENTITY, diviner)?.endedAt !== undefined) return null;
  if (truth.get(ENTITY, client)?.endedAt !== undefined) return null;
  const method = o.methods.find((m) => m.id === role.method);
  if (!method) return null;
  const r = rng.fork("consult", diviner, client, cause);
  const want = Math.max(-1, Math.min(1, data.want ?? 0));
  const signals = data.signals ?? {};
  const cues = data.asked ? { signals, asked: data.asked } : { signals };
  const c = streetConsult(method, role, client, cues, want, r);
  // Quien dice una profecía de calle la cree a medias: más cuanto menos halaga.
  const conviction = 0.45 + 0.3 * (1 - role.flattery);
  const root = utter(diviner, c.utterance.claim, method.id, conviction, cause, now);
  const curious = clampTemper(truth.get(INNATE, client)?.["curiosity"] ?? 0);
  const hearer = {
    id: client,
    credulity: credulity({ tradition: 0.5 - 0.5 * curious, curiosity: 0.5 + 0.5 * curious }),
    trustInTeller: 2 * renown(role.record) - 1,
  };
  const heard = transmit(root, diviner, hearer, role.flattery, cause, now, r.fork("tell"));
  const changes: StateChange[] = [
    setComponent(PROPHECY_BELIEFS, diviner, receive(beliefs(diviner), root)),
    setComponent(PROPHECY_BELIEFS, client, receive(beliefs(client), heard)),
  ];
  const events: EventDraft[] = [
    {
      kind: READING_EVENT,
      actors: [diviner, client],
      place: o.placeOf(truth, diviner),
      data: {
        prophecy: root.id,
        method: method.id,
        signs: c.omen.signs,
        kind: heard.claim.kind,
        intensity: heard.claim.intensity,
        credence: heard.credence,
        vagueness: c.utterance.vagueness,
        // Solo para el inspector: lo que el adivino creyó ver, no lo que el cliente supo.
        read: { concern: c.reading.concern, grasp: c.reading.grasp },
      },
      emissions: {},
      causes: [{ kind: "event", event: cause }],
    },
  ];
  return { changes, events };
}

/** Monedas por debajo de las cuales la bolsa se ve flaca. */
export const THIN_PURSE_COINS = 20;
/** Gravedad de herida que ya se nota al caminar (cojera, brazo en cabestrillo). */
export const LIMP_FROM = 0.3;

/**
 * Lo que un adivino le ve a alguien a simple vista (divination §4): cojera o vendas (salud), la
 * bolsa flaca (plata), los nervios de quien carga trauma o culpa (miedo). Es lo que se ve, no lo
 * que hay: una herida por dentro o una deuda no se ven. El duelo y la familia quedan para cuando
 * la mente tenga duelo con causa.
 */
export function visibleSignals(
  truth: ReadonlyWorldTruth,
  ledger: ReadonlyLedger | undefined,
  who: AgentId,
): Partial<Record<Concern, number>> {
  const out: Partial<Record<Concern, number>> = {};
  const body = truth.get(BODY_STATE, who);
  const hurt = Math.max(
    0,
    ...(body?.wounds ?? [])
      .filter((w) => w.stage !== "healed" && w.internal === 0)
      .map((w) => (w.fracture ? Math.max(w.severity, 0.6) : w.severity)),
  );
  if (hurt >= LIMP_FROM) out["health"] = Math.min(1, hurt);
  if (ledger) {
    const coins = ledger
      .holdings(holderAccount(who as unknown as HolderRef))
      .filter((h) => isMoney(h.unit))
      .reduce((s, h) => s + h.amount, 0);
    if (coins < THIN_PURSE_COINS) out["money"] = 1 - coins / THIN_PURSE_COINS;
  }
  const nerves = Math.max(0, ...(truth.get(MENTAL, who)?.conditions ?? []).map((c) => c.severity));
  if (nerves > 0) out["fear"] = Math.min(1, nerves);
  return out;
}

/** Lo que dejó dicho un `action.consult` del personaje (resolve): a quién, qué y cuánto pagó. */
function playedConsult(
  e: Event,
  o: DivineOptions,
  truth: ReadonlyWorldTruth,
  ledger: ReadonlyLedger | undefined,
): { client: AgentId; diviner: AgentId; data: ConsultData } | null {
  const [client, diviner] = e.actors as AgentId[];
  const eff = (
    e.data as {
      effect?: {
        kind?: string;
        delivered?: boolean;
        asked?: string | null;
        paid?: { unit: string; amount: number } | null;
      };
    } | null
  )?.effect;
  if (!client || !diviner || eff?.kind !== "consult" || !eff.delivered) return null;
  const asked = concernIn(eff.asked ?? null, o.concerns);
  return {
    client,
    diviner,
    data: {
      ...(asked ? { asked } : {}),
      signals: visibleSignals(truth, ledger, client),
      ...(eff.paid ? { paid: eff.paid } : {}),
    },
  };
}

function consultOf(
  e: Event,
  o: DivineOptions,
  truth: ReadonlyWorldTruth,
  ledger: ReadonlyLedger | undefined,
): { client: AgentId; diviner: AgentId; data: ConsultData } | null {
  if (e.kind === "action.consult") return playedConsult(e, o, truth, ledger);
  if (e.kind !== CONSULT_EVENT) return null;
  const [client, diviner] = e.actors as AgentId[];
  if (!client || !diviner) return null;
  return { client, diviner, data: (e.data ?? {}) as ConsultData };
}

export function consultProcess(o: DivineOptions): ProcessDef {
  return {
    id: CONSULT_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      DIVINER_ROLE.name,
      PROPHECY_BELIEFS.name,
      INNATE.name,
      ENTITY.name,
      BODY_STATE.name,
      MENTAL.name,
    ],
    writes: [PROPHECY_BELIEFS.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      // Varias consultas en el mismo paso se suman sobre lo que ya cambió.
      const now = new Map<AgentId, ProphecyBeliefs>();
      const beliefs = (who: AgentId) => now.get(who) ?? ctx.truth.get(PROPHECY_BELIEFS, who);
      for (const e of ctx.recent) {
        const q = consultOf(e, o, ctx.truth, ctx.ledger);
        if (!q) continue;
        const out = consultDiviner(
          ctx.truth,
          o,
          q.diviner,
          q.client,
          q.data,
          e.id,
          ctx.now,
          ctx.rng,
          beliefs,
        );
        if (!out) continue;
        for (const ch of out.changes) {
          if (ch.op === "set") now.set(ch.id as AgentId, ch.value as ProphecyBeliefs);
        }
        changes.push(...out.changes);
        events.push(...out.events);
      }
      return changes.length === 0 && events.length === 0 ? {} : { changes, events };
    },
  };
}
