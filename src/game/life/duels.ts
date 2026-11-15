// Los duelos acordados (novel3-challenge-ask, combat §13): un desafío aceptado (`combat.challenge`
// con respuesta `accept`, de `life.converse`) queda anotado en `DUEL` de los dos, con la regla y
// hasta cuándo vale. Lo escribe este proceso y no la conversación, que solo escribe en quien oye.
// Los vencidos se borran solos al pasar por acá.
//
// La pelea del duelo (novel3-challenge-fight): un `combat.fight` con `duel` en sus datos, terminado
// (no pausado), cierra el duelo de los dos y mueve la cara del vencedor y del vencido por `duelFace`
// (los presentes donde quedó el vencedor, la regla, la distancia de rango en la secta). Vence quien
// quedó en pie con el otro rendido, caído, muerto o huido; a primera sangre, quien no sangró en el
// último pulso. Sin vencedor claro (los dos en pie o los dos caídos), el duelo se cierra sin cara.
//
// La plataforma de vida o muerte (novel3-challenge-platform): un duelo a muerte entre dos de una
// secta solo se respeta peleado en la plataforma de la sede ante un anciano (o el maestro) de esa
// secta (`platformElder`); en otro lado, matar en duelo es matar. El acuerdo es de los dos y de la
// secta, no de la familia del muerto: cada uno de su casa puede no respetarlo y quedarse con el
// hecho (`combat.duel_grudge`, que la aldea lee como agresión del vencedor), más cuanto más
// reactivo es.

import {
  type AgentId,
  compareStrings,
  type EntityRef,
  type Event,
  type Tick,
} from "../../core/index.ts";
import {
  adjustFace,
  BODY_STATE,
  type Candidate,
  CHALLENGE_COOLDOWN_DAYS,
  CHALLENGE_EVENT,
  CHALLENGES_SENT,
  DUEL,
  DUEL_DAYS,
  DUEL_OFFER,
  DUEL_OFFER_HOURS,
  type Duel,
  type DuelOffer,
  type DuelRule,
  deleteComponent,
  duelFace,
  ENTITY,
  type EventDraft,
  FACE,
  type Face,
  INNATE,
  isSectArena,
  LOCATION,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  SECT_MEMBER,
  STAKES_RISK,
  type StateChange,
  setComponent,
  standardize,
  type Trait,
} from "../../sim/index.ts";

/** El evento del duelo peleado: la regla, quién ganó y la cara que se movió. */
export const DUEL_SETTLED_EVENT = "combat.duel_settled";

/**
 * Un familiar del muerto en la plataforma que no respeta el acuerdo: actores `[vencedor, muerto,
 * familiar]`; el familiar se queda con el hecho como una agresión del vencedor.
 */
export const DUEL_GRUDGE_EVENT = "combat.duel_grudge";

/** Cuánto pesa no respetar el acuerdo: la base y lo que suma la reactividad (z). */
const GRUDGE_BASE = 0.3;
const GRUDGE_REACTIVITY = 0.15;

const unit = (x: number) => Math.min(1, Math.max(0, x));

const RANKS = ["outer", "inner", "core", "elder", "master"] as const;
const LOST = new Set(["yielded", "down", "dead", "fled"]);

/** Pura: quién ganó y quién perdió un `combat.fight` de duelo, o nada si no hay vencedor claro. */
export function duelVictor(
  e: Pick<Event, "actors" | "data">,
): { readonly winner: AgentId; readonly loser: AgentId } | undefined {
  const [a, b] = e.actors as AgentId[];
  const d = e.data as {
    end?: string;
    outcomes?: Readonly<Record<string, string>>;
    hits?: readonly { t: Tick; to: AgentId }[];
  } | null;
  if (!a || !b || !d) return undefined;
  if (d.end === "first_blood") {
    const hits = d.hits ?? [];
    const last = Math.max(...hits.map((h) => h.t));
    const bled = new Set(hits.filter((h) => h.t === last).map((h) => h.to));
    if (bled.size !== 1) return undefined;
    const loser = [...bled][0] as AgentId;
    return { winner: loser === a ? b : a, loser };
  }
  const lostA = LOST.has(d.outcomes?.[a] ?? "");
  const lostB = LOST.has(d.outcomes?.[b] ?? "");
  if (lostA === lostB) return undefined;
  return lostA ? { winner: b, loser: a } : { winner: a, loser: b };
}

/** Los que vieron cómo quedó: vivos en el mismo lugar que `who`, sin contar a los dos. */
function presentAt(truth: ReadonlyWorldTruth, who: AgentId, other: AgentId): number {
  const at = truth.get(LOCATION, who);
  if (!at) return 0;
  return truth.ids(PERSON).filter((id) => {
    if (id === who || id === other) return false;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) return false;
    if ((truth.get(BODY_STATE, id)?.death ?? null) !== null) return false;
    const there = truth.get(LOCATION, id);
    return there?.hex === at.hex && there.space === at.space;
  }).length;
}

function sameSpot(truth: ReadonlyWorldTruth, a: AgentId, b: AgentId): boolean {
  const la = truth.get(LOCATION, a);
  const lb = truth.get(LOCATION, b);
  return la !== undefined && lb !== undefined && la.hex === lb.hex && la.space === lb.space;
}

/**
 * El anciano (o el maestro) que mira un duelo en la plataforma de vida o muerte: `a` y `b` en la
 * plataforma de una sede, los dos de la misma secta, y uno de arriba de esa secta ahí, vivo y
 * despierto. El primero por id; nada si falta algo.
 */
export function platformElder(
  truth: ReadonlyWorldTruth,
  a: AgentId,
  b: AgentId,
): AgentId | undefined {
  const at = truth.get(LOCATION, a);
  if (!at || !isSectArena(at.space) || !sameSpot(truth, a, b)) return undefined;
  const ma = truth.get(SECT_MEMBER, a);
  const mb = truth.get(SECT_MEMBER, b);
  if (!ma || !mb || ma.org !== mb.org) return undefined;
  return (truth.ids(SECT_MEMBER) as AgentId[])
    .filter((id) => id !== a && id !== b)
    .sort(compareStrings)
    .find((id) => {
      const m = truth.get(SECT_MEMBER, id);
      if (m?.org !== ma.org || (m.rank !== "elder" && m.rank !== "master")) return false;
      if (truth.get(ENTITY, id)?.endedAt !== undefined) return false;
      const body = truth.get(BODY_STATE, id);
      if (!body || body.death !== null || body.activity === "sleep") return false;
      return sameSpot(truth, id, a);
    });
}

/** Escalones de rango de `a` sobre `b` en una misma secta (0 si no lo son). */
function rankGap(truth: ReadonlyWorldTruth, a: AgentId, b: AgentId): number {
  const ma = truth.get(SECT_MEMBER, a);
  const mb = truth.get(SECT_MEMBER, b);
  if (!ma || !mb || ma.org !== mb.org) return 0;
  return RANKS.indexOf(ma.rank) - RANKS.indexOf(mb.rank);
}

export const DUELS_PROCESS = "life.duels";

/** Opt-in de `decideProcess`: los discípulos retan a quien les tiene rencor (novel3-challenge-npc). */
export interface ChallengeCandidateOptions {
  /** Rencor desde el que se le ocurre retarlo. */
  readonly minResentment: number;
  /** Rencor desde el que lo reta a muerte (en la plataforma); por debajo, hasta rendirse. */
  readonly deathResentment: number;
  /** Peso del ánimo (como `speakActs.weight`). */
  readonly weight: number;
  readonly chance: number;
  readonly dayTicks: number;
}

/**
 * Las candidatas `speak` con acto `challenge` de un discípulo (puro). Solo contra alguien de su
 * misma secta (lo sabe: la secta se conoce adentro), sin un duelo pactado vivo de ninguno de los
 * dos, ni un desafío propio a la misma persona en los últimos `CHALLENGE_COOLDOWN_DAYS` días.
 */
export function challengeCandidates(
  truth: ReadonlyWorldTruth,
  me: AgentId,
  people: readonly { readonly id: AgentId; readonly resentment: number }[],
  now: Tick,
  o: ChallengeCandidateOptions,
): Candidate[] {
  const mine = truth.get(SECT_MEMBER, me);
  if (!mine || truth.has(DUEL, me)) return [];
  const sent = truth.get(CHALLENGES_SENT, me) ?? {};
  const out: Candidate[] = [];
  for (const p of [...people].sort((a, b) => compareStrings(a.id, b.id))) {
    if (p.resentment < o.minResentment) continue;
    if (truth.get(SECT_MEMBER, p.id)?.org !== mine.org || truth.has(DUEL, p.id)) continue;
    const last = sent[p.id];
    if (last !== undefined && now - last < CHALLENGE_COOLDOWN_DAYS * o.dayTicks) continue;
    out.push({
      id: `speak:${p.id}+challenge`,
      verb: "speak",
      target: p.id as unknown as EntityRef,
      contributes: { social: 0.2 },
      chance: o.chance,
      loss: STAKES_RISK.none.loss,
      mood: Math.round(o.weight * p.resentment * 1e6) / 1e6,
      act: { kind: "challenge", rule: p.resentment >= o.deathResentment ? "death" : "yield" },
    });
  }
  return out;
}

export function duelsProcess(o: {
  readonly dayTicks: number;
  readonly hourTicks: number;
  /** Con qué se lee el temperamento de la familia del muerto (sin esto, la base). */
  readonly traits?: readonly Trait[];
}): ProcessDef {
  return {
    id: DUELS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      DUEL.name,
      FACE.name,
      LOCATION.name,
      PERSON.name,
      ENTITY.name,
      BODY_STATE.name,
      SECT_MEMBER.name,
      INNATE.name,
      DUEL_OFFER.name,
      CHALLENGES_SENT.name,
    ],
    writes: [DUEL.name, FACE.name, DUEL_OFFER.name, CHALLENGES_SENT.name],
    run(ctx) {
      const set = new Map<AgentId, Duel>();
      const closed = new Set<AgentId>();
      const faces = new Map<AgentId, Face>();
      const offers = new Map<AgentId, DuelOffer | null>();
      const sent = new Map<AgentId, Readonly<Record<string, Tick>>>();
      const events: EventDraft[] = [];
      for (const e of ctx.recent) {
        if (e.kind === "combat.fight") {
          const d = e.data as {
            duel?: { rule?: DuelRule; platform?: AgentId };
            outcomes?: Readonly<Record<string, string>>;
            paused?: unknown;
          } | null;
          const rule = d?.duel?.rule;
          if (!rule || d?.paused !== undefined) continue;
          const [a, b] = e.actors as AgentId[];
          if (!a || !b) continue;
          closed.add(a);
          closed.add(b);
          set.delete(a);
          set.delete(b);
          const v = duelVictor(e);
          if (!v) continue;
          const face = duelFace(
            rule,
            presentAt(ctx.truth, v.winner, v.loser),
            rankGap(ctx.truth, v.loser, v.winner),
          );
          for (const [who, delta] of [
            [v.winner, face.win],
            [v.loser, -face.lose],
          ] as const) {
            faces.set(who, adjustFace(faces.get(who) ?? ctx.truth.get(FACE, who), delta, e.tick));
          }
          events.push({
            kind: DUEL_SETTLED_EVENT,
            actors: [v.winner, v.loser],
            place: e.place,
            data: { rule, winner: v.winner, loser: v.loser, face: face.win },
            emissions: {},
            causes: [{ kind: "event", event: e.id }],
          });
          // La familia del muerto en la plataforma puede no respetar el acuerdo.
          const home = ctx.truth.get(PERSON, v.loser)?.household;
          if (rule !== "death" || !d?.duel?.platform || d.outcomes?.[v.loser] !== "dead") continue;
          if (home === undefined) continue;
          for (const kin of (ctx.truth.ids(PERSON) as AgentId[]).sort(compareStrings)) {
            if (kin === v.loser || kin === v.winner) continue;
            const p = ctx.truth.get(PERSON, kin);
            if (p?.household !== home || ctx.truth.get(ENTITY, kin)?.endedAt !== undefined)
              continue;
            if ((ctx.truth.get(BODY_STATE, kin)?.death ?? null) !== null) continue;
            const innate = ctx.truth.get(INNATE, kin);
            const z = innate && o.traits ? standardize(innate, o.traits, p.sex) : {};
            const chance = unit(GRUDGE_BASE + GRUDGE_REACTIVITY * (z["reactivity"] ?? 0));
            if (ctx.rng.fork("duel-grudge", e.id, kin).float() >= chance) continue;
            events.push({
              kind: DUEL_GRUDGE_EVENT,
              actors: [v.winner, v.loser, kin],
              place: e.place,
              data: { rule, elder: d.duel.platform },
              emissions: {},
              causes: [{ kind: "event", event: e.id }],
            });
          }
          continue;
        }
        if (e.kind !== CHALLENGE_EVENT) continue;
        const d = e.data as {
          challenger?: AgentId;
          challenged?: AgentId;
          rule?: DuelRule;
          response?: string;
          refuseFace?: number;
        } | null;
        if (!d?.challenger || !d.challenged || !d.rule) continue;
        // Cuándo retó a quién (para no retar a cada rato al mismo).
        sent.set(d.challenger, {
          ...(sent.get(d.challenger) ?? ctx.truth.get(CHALLENGES_SENT, d.challenger)),
          [d.challenged]: e.tick,
        });
        if (d.response === "pending") {
          offers.set(d.challenged, {
            from: d.challenger,
            rule: d.rule,
            at: e.tick,
            until: e.tick + DUEL_OFFER_HOURS * o.hourTicks,
            refuseFace: d.refuseFace ?? 0,
            event: e.id,
            place: e.place,
          });
          continue;
        }
        if (ctx.truth.get(DUEL_OFFER, d.challenged)?.from === d.challenger) {
          offers.set(d.challenged, null);
        }
        if (d.response !== "accept") continue;
        const until = e.tick + DUEL_DAYS * o.dayTicks;
        const base = { rule: d.rule, challenger: d.challenger, at: e.tick, until, event: e.id };
        set.set(d.challenger, { ...base, with: d.challenged });
        set.set(d.challenged, { ...base, with: d.challenger });
      }
      // El desafío al personaje que se le pasó sin respuesta: delante de otros, como rechazarlo.
      for (const id of [...ctx.truth.ids(DUEL_OFFER)].sort(compareStrings) as AgentId[]) {
        const offer = ctx.truth.get(DUEL_OFFER, id);
        if (!offer || offers.has(id) || ctx.now <= offer.until) continue;
        offers.set(id, null);
        if (offer.refuseFace > 0) {
          faces.set(
            id,
            adjustFace(faces.get(id) ?? ctx.truth.get(FACE, id), -offer.refuseFace, ctx.now),
          );
          faces.set(
            offer.from,
            adjustFace(
              faces.get(offer.from) ?? ctx.truth.get(FACE, offer.from),
              offer.refuseFace / 2,
              ctx.now,
            ),
          );
        }
        events.push({
          kind: CHALLENGE_EVENT,
          actors: [offer.from, id],
          place: offer.place,
          data: {
            challenger: offer.from,
            challenged: id,
            rule: offer.rule,
            response: "ignored",
            refuseFace: offer.refuseFace,
          },
          emissions: {},
          causes: [{ kind: "event", event: offer.event }],
        });
      }
      const changes: StateChange[] = [];
      for (const [id, offer] of [...offers].sort(([a], [b]) => compareStrings(a, b))) {
        changes.push(offer ? setComponent(DUEL_OFFER, id, offer) : deleteComponent(DUEL_OFFER, id));
      }
      for (const [id, s] of [...sent].sort(([a], [b]) => compareStrings(a, b))) {
        changes.push(setComponent(CHALLENGES_SENT, id, s));
      }
      for (const id of [...ctx.truth.ids(DUEL)].sort(compareStrings) as AgentId[]) {
        const d = ctx.truth.get(DUEL, id);
        if (!d || set.has(id)) continue;
        if (closed.has(id) || ctx.now > d.until) changes.push(deleteComponent(DUEL, id));
      }
      for (const [id, d] of [...set].sort(([a], [b]) => compareStrings(a, b))) {
        changes.push(setComponent(DUEL, id, d));
      }
      for (const [id, f] of [...faces].sort(([a], [b]) => compareStrings(a, b))) {
        changes.push(setComponent(FACE, id, f));
      }
      if (changes.length === 0 && events.length === 0) return {};
      return { changes, ...(events.length > 0 ? { events } : {}) };
    },
  };
}
