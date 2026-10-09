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
  CONCERNS,
  type Concern,
  type ConcernWords,
  clampTemper,
  concernIn,
  credulity,
  DIVINER_ROLE,
  type DivinationMethodDef,
  type DiviningCandidate,
  divinerSlots,
  draftEvent,
  ENTITY,
  type EventDraft,
  INNATE,
  isMoney,
  MENTAL,
  PERSON,
  type PostingDraft,
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
import type { ToldProphecy } from "./converse.ts";

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

export const RETOLD_PROCESS = "life.retold";
export const RETOLD_EVENT = "divination.retold";

/**
 * Anota una profecía contada en el diálogo (divination §5): el oyente la guarda como le llegó, con
 * el salto de quien se la contó en el linaje (el evento real de su respuesta); si quien habla no
 * sabía de ninguna así, nace ahí con él como raíz (método `spoken`) y la guarda también. Devuelve
 * null si el evento no trae una profecía contada.
 */
export function retellProphecy(
  e: Event,
  beliefs: (who: AgentId) => ProphecyBeliefs | undefined,
): { changes: StateChange[]; events: EventDraft[] } | null {
  const told = (e.data as { effect?: { kind?: string; prophecy?: ToldProphecy } } | null)?.effect;
  const p = told?.kind === "speak" ? told.prophecy : undefined;
  if (!p) return null;
  let heard = p.heard;
  const changes: StateChange[] = [];
  if (p.fresh) {
    const root = utter(p.speaker, p.told.claim, p.told.root.method, p.told.credence, e.id, e.tick);
    heard = { ...heard, id: root.id, root: root.root };
    changes.push(setComponent(PROPHECY_BELIEFS, p.speaker, receive(beliefs(p.speaker), root)));
  }
  // El último salto es el de esta conversación: se le pone el evento que ya existe.
  const lineage = heard.lineage.map((h, i) =>
    i === heard.lineage.length - 1 ? { ...h, event: e.id } : h,
  );
  heard = { ...heard, lineage };
  changes.push(setComponent(PROPHECY_BELIEFS, p.listener, receive(beliefs(p.listener), heard)));
  return {
    changes,
    events: [
      {
        kind: RETOLD_EVENT,
        actors: [p.speaker, p.listener],
        place: e.place,
        data: {
          prophecy: heard.id,
          kind: heard.claim.kind,
          intensity: heard.claim.intensity,
          credence: heard.credence,
          hops: heard.hops,
          verdict: p.verdict,
          fresh: p.fresh,
        },
        emissions: {},
        causes: [{ kind: "event", event: e.id }],
      },
    ],
  };
}

/** Las profecías que el personaje o un vecino cuentan en una conversación quedan en el oyente. */
export function retoldProcess(): ProcessDef {
  return {
    id: RETOLD_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [PROPHECY_BELIEFS.name],
    writes: [PROPHECY_BELIEFS.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const now = new Map<AgentId, ProphecyBeliefs>();
      const beliefs = (who: AgentId) => now.get(who) ?? ctx.truth.get(PROPHECY_BELIEFS, who);
      for (const e of ctx.recent) {
        if (e.kind !== "action.speak") continue;
        const out = retellProphecy(e, beliefs);
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

export const VISITS_PROCESS = "life.visits";

/** Desde cuánta preocupación (0-1) alguien se plantea ir al adivino. */
export const WORRY_FROM = 0.35;
/** Chance diaria de ir con la preocupación al máximo y curiosidad media (sin calibrar). */
export const VISIT_HAZARD = 0.12;
/** Lo que se deja en la mano del adivino: una moneda de la bolsa más gorda (sin calibrar). */
export const VISIT_FEE = 1;
/** Días que una persona espera antes de volver a consultar (ya tiene una respuesta que rumiar). */
export const VISIT_COOLDOWN_DAYS = 20;

/**
 * Lo que alguien siente que lo preocupa, por lo que cree de sí (divination §8): el cuerpo que
 * le duele, la bolsa que sabe flaca, los nervios que carga y las profecías sobre sí mismo que
 * cree (ruina o muerte dan miedo; grandeza o fortuna, ambición). Nada sale de la verdad del
 * futuro ni de lo que otros saben de él.
 */
export function feltWorries(
  truth: ReadonlyWorldTruth,
  ledger: ReadonlyLedger | undefined,
  who: AgentId,
): Partial<Record<Concern, number>> {
  const out = { ...visibleSignals(truth, ledger, who) };
  for (const p of truth.get(PROPHECY_BELIEFS, who)?.items ?? []) {
    if (p.claim.subject !== who) continue;
    const weight = p.credence * p.claim.intensity;
    const concern: Concern =
      p.claim.kind === "ruin" || p.claim.kind === "death" ? "fear" : "ambition";
    out[concern] = Math.min(1, Math.max(out[concern] ?? 0, weight));
  }
  return out;
}

/** La preocupación mayor (empate: el orden de `CONCERNS`) o nada si ninguna llega a `WORRY_FROM`. */
export function topWorry(
  worries: Partial<Record<Concern, number>>,
): { concern: Concern; strength: number } | null {
  let best: { concern: Concern; strength: number } | null = null;
  for (const concern of CONCERNS) {
    const strength = worries[concern] ?? 0;
    if (strength >= WORRY_FROM && (!best || strength > best.strength)) best = { concern, strength };
  }
  return best;
}

/** Chance diaria de ir: crece con la preocupación y con la curiosidad (fe en lo que se lee). */
export function visitHazard(strength: number, curiosity: number): number {
  const over = (strength - WORRY_FROM) / (1 - WORRY_FROM);
  return Math.max(0, VISIT_HAZARD * (0.4 + 0.6 * over) * (0.75 + 0.25 * curiosity));
}

/**
 * Quién va al adivino y cuándo (divination §8): cada día, cada vecino que no es el jugador, ni
 * adivino, con una preocupación sentida por encima del umbral, plata para pagar y sin una
 * consulta reciente, tira su chance. Si va, elige al adivino de mejor fama (la que le llega:
 * `renown`) y el evento `divination.consult` lleva lo que pregunta, lo que ve el adivino y el
 * pago, que sale de su bolsa a la del adivino por el ledger.
 */
export function visitsProcess(o: DivineOptions & { readonly player: AgentId }): ProcessDef {
  return {
    id: VISITS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "act",
    reads: [
      DIVINER_ROLE.name,
      PROPHECY_BELIEFS.name,
      INNATE.name,
      ENTITY.name,
      PERSON.name,
      BODY_STATE.name,
      MENTAL.name,
    ],
    writes: [],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger) return {};
      const alive = livingPeople(ctx.truth);
      const diviners = alive
        .filter((id) => ctx.truth.get(DIVINER_ROLE, id) !== undefined)
        .flatMap((id) => {
          const role = ctx.truth.get(DIVINER_ROLE, id);
          return role ? [{ id, renown: renown(role.record) }] : [];
        })
        .sort((a, b) => b.renown - a.renown || (a.id < b.id ? -1 : 1));
      if (diviners.length === 0) return {};
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const spent = new Map<AgentId, number>();
      for (const client of alive) {
        if (client === o.player || ctx.truth.get(DIVINER_ROLE, client)) continue;
        const items = ctx.truth.get(PROPHECY_BELIEFS, client)?.items ?? [];
        if (items.some((p) => ctx.now - p.learnedAt < VISIT_COOLDOWN_DAYS * o.clock.day)) continue;
        const signals = feltWorries(ctx.truth, ledger, client);
        const worry = topWorry(signals);
        if (!worry) continue;
        const curious = clampTemper(ctx.truth.get(INNATE, client)?.["curiosity"] ?? 0);
        if (!ctx.rng.fork("visit", client).chance(visitHazard(worry.strength, curious))) continue;
        const purse = ledger
          .holdings(holderAccount(client as unknown as HolderRef))
          .filter((h) => isMoney(h.unit) && h.amount - (spent.get(client) ?? 0) >= VISIT_FEE)
          .sort((a, b) => b.amount - a.amount || (a.unit < b.unit ? -1 : 1))[0];
        const diviner = diviners.find((d) => d.id !== client);
        if (!purse || !diviner) continue;
        const draft = draftEvent(events.length);
        events.push({
          kind: CONSULT_EVENT,
          actors: [client, diviner.id],
          place: o.placeOf(ctx.truth, diviner.id),
          data: {
            asked: worry.concern,
            want: Math.round(40 * worry.strength) / 100,
            signals,
            paid: { unit: purse.unit, amount: VISIT_FEE },
          } satisfies ConsultData,
          emissions: {},
          causes: [{ kind: "state", entity: client, key: `divination.worry.${worry.concern}` }],
        });
        postings.push({
          event: draft,
          transfers: [
            {
              unit: purse.unit,
              from: holderAccount(client as unknown as HolderRef),
              to: holderAccount(diviner.id as unknown as HolderRef),
              amount: VISIT_FEE,
            },
          ],
        });
        spent.set(client, (spent.get(client) ?? 0) + VISIT_FEE);
      }
      return events.length === 0 ? {} : { events, postings };
    },
  };
}
