// Las personas que más pesaron en una vida (chronicle §4) y lo que el personaje nunca supo de
// ellas (chronicle §5). Todo sale de la verdad al momento de la muerte: las relaciones (en las dos
// direcciones), las memorias del personaje y el registro de eventos. Nada de esto lo lee la sim.
// Las intrigas (schemes) llegan con su sistema; acá entra lo que ya existe: creencias, memorias y
// peleas que el personaje no vio.

import {
  type AgentId,
  compareStrings,
  type Event,
  type EventId,
  parseId,
  type Tick,
} from "../../core/index.ts";
import {
  BELIEFS,
  believed,
  ENTITY,
  MEMORIES,
  MIND,
  PERSON,
  RELATIONS,
  relationship,
  salienceAt,
  type Vector,
} from "../../sim/index.ts";
import type { LifeWorld } from "../life/index.ts";

export const MAX_PEOPLE_IN_CHRONICLE = 5;
export const MAX_NEVER_KNEW = 6;
/** Bajo este puntaje alguien no cuenta como importante. */
export const MIN_IMPORTANCE = 0.08;

export interface ImportantPerson {
  readonly who: AgentId;
  /** 0-1: cuánto pesó, por relación en las dos direcciones y por memoria. */
  readonly score: number;
  readonly bonds: readonly string[];
  /** Las dimensiones más fuertes de lo que el personaje sentía por esa persona. */
  readonly feltFor: readonly string[];
  /** Las memorias del personaje con esa persona, de más a menos pesada. */
  readonly memories: readonly EventId[];
  readonly alive: boolean;
}

export type NeverKnewKind =
  | "died_unknown" // alguien importante murió y el personaje no se enteró (o creía que vivía)
  | "misremembered" // el personaje recuerda un hecho con otra gente que la que estuvo
  | "unseen_clash"; // una pelea de alguien importante que el personaje no vio

export interface NeverKnewEntry {
  readonly kind: NeverKnewKind;
  readonly who: AgentId;
  /** Quiénes participaron de verdad, además del personaje y de `who`. */
  readonly others: readonly AgentId[];
  /** La verdad: el evento que lo muestra (y que la crónica cita). */
  readonly event: EventId;
  /** Lo que el personaje recordaba, si recordaba otra cosa (para `misremembered`: con quién). */
  readonly believedWith?: readonly AgentId[];
  readonly weight: number;
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const byId = (a: AgentId, b: AgentId) => compareStrings(a, b);
const byNumber = (a: EventId, b: EventId) => (parseId(a)?.n as number) - (parseId(b)?.n as number);
const isAgent = (id: string): id is AgentId => parseId(id)?.kind === "agent";

/** Cuánto vale un vector de relación como importancia, 0-1. */
export function relationWeight(d: Vector): number {
  return (
    0.3 * d.familiarity +
    0.2 * Math.abs(d.affection) +
    0.1 * d.gratitude +
    0.1 * d.resentment +
    0.1 * d.fear +
    0.1 * d.attraction +
    0.1 * d.dependency
  );
}

function strongest(d: Vector): string[] {
  return Object.entries(d)
    .filter(([k, v]) => k !== "familiarity" && Math.abs(v) >= 0.3)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || compareStrings(a[0], b[0]))
    .slice(0, 3)
    .map(([k]) => k);
}

/** Las personas que más pesaron en la vida de `me` al momento `now`. */
export function importantPeople(w: LifeWorld, me: AgentId, now: Tick): ImportantPerson[] {
  const ctxOf = (holder: AgentId) => ({
    dims: w.relationDims,
    bonds: w.relationBonds,
    schemaStrength: (s: string) => w.truth.get(MIND, holder)?.schemas[s]?.strength ?? 0,
  });
  const memories = w.truth.get(MEMORIES, me);
  const candidates = new Set<AgentId>();
  for (const id of Object.keys(w.truth.get(RELATIONS, me)?.toward ?? {})) {
    if (isAgent(id)) candidates.add(id);
  }
  for (const m of memories?.items ?? []) for (const o of m.perceived.with) candidates.add(o);
  for (const g of memories?.gists ?? []) for (const o of g.with) candidates.add(o);
  for (const id of w.truth.ids(PERSON) as AgentId[]) {
    if (id !== me && w.truth.get(RELATIONS, id)?.toward[me]) candidates.add(id);
  }
  candidates.delete(me);

  const out: ImportantPerson[] = [];
  for (const who of [...candidates].sort(byId)) {
    if (!w.truth.get(PERSON, who)) continue;
    const mine = relationship(w.truth.get(RELATIONS, me), who, now, ctxOf(me));
    const theirs = relationship(w.truth.get(RELATIONS, who), me, now, ctxOf(who));
    const lived = (memories?.items ?? [])
      .filter((m) => m.perceived.with.includes(who))
      .map((m) => ({ m, v: salienceAt(m, now) * m.intensity }))
      .sort((a, b) => b.v - a.v || byNumber(a.m.eventId, b.m.eventId));
    const gist = (memories?.gists ?? [])
      .filter((g) => g.with.includes(who))
      .reduce((s, g) => s + g.peak * Math.min(g.count, 5) * 0.2, 0);
    const memoryScore = Math.min(1, lived.reduce((s, x) => s + x.v, 0) + gist);
    const bondBonus = Math.min(0.1, 0.05 * mine.bonds.length);
    const score = round(
      Math.min(
        1,
        0.45 * relationWeight(mine.dims) +
          0.15 * relationWeight(theirs.dims) +
          0.4 * memoryScore +
          bondBonus,
      ),
    );
    if (score < MIN_IMPORTANCE) continue;
    out.push({
      who,
      score,
      bonds: mine.bonds,
      feltFor: strongest(mine.dims),
      memories: lived.slice(0, 3).map((x) => x.m.eventId),
      alive: w.truth.get(ENTITY, who)?.endedAt === undefined,
    });
  }
  return out
    .sort((a, b) => b.score - a.score || byId(a.who, b.who))
    .slice(0, MAX_PEOPLE_IN_CHRONICLE);
}

const CLASH_KINDS: ReadonlySet<string> = new Set(["combat.fight", "combat.finish"]);

/**
 * Lo que el personaje creyó mal o nunca vio, contra la verdad, ponderado por cuánto pesaba la
 * persona. Se eligen los de más peso (chronicle §5): no se listan todos.
 */
export function neverKnew(
  w: LifeWorld,
  me: AgentId,
  people: readonly ImportantPerson[],
  until: Tick,
): NeverKnewEntry[] {
  const out: NeverKnewEntry[] = [];
  const beliefs = w.truth.get(BELIEFS, me);
  const memories = w.truth.get(MEMORIES, me);
  const remembered = new Set<EventId>((memories?.items ?? []).map((m) => m.eventId));
  for (const g of memories?.gists ?? []) for (const c of g.causes) remembered.add(c);
  const importance = new Map(people.map((p) => [p.who, p.score]));
  const others = (e: Event, ...skip: AgentId[]) =>
    e.actors.filter((a): a is AgentId => isAgent(a) && !skip.includes(a)).sort(byId);

  for (const p of people) {
    // Murió y no se enteró: no la vio, no la recuerda y no cree que haya muerto.
    const end = w.truth.get(ENTITY, p.who)?.endEventId;
    const death = end ? w.log.get(end) : undefined;
    if (!death || death.kind !== "body.died" || remembered.has(death.id)) continue;
    const b = believed(beliefs, p.who, "alive");
    if (b?.value === false) continue;
    const ancestors = w.log
      .ancestors(death.id)
      .map((id) => w.log.get(id))
      .filter((e): e is Event => e !== undefined && CLASH_KINDS.has(e.kind));
    const doers = new Set<AgentId>(others(death, p.who));
    for (const e of ancestors) for (const a of others(e, p.who, me)) doers.add(a);
    out.push({
      kind: "died_unknown",
      who: p.who,
      others: [...doers].sort(byId),
      event: death.id,
      weight: round(p.score * (b?.value === true ? 1 : 0.8)),
    });
  }

  for (const e of w.log.all()) {
    if (e.tick > until || !CLASH_KINDS.has(e.kind)) continue;
    if (e.actors.includes(me) || remembered.has(e.id)) continue;
    for (const who of others(e)) {
      const imp = importance.get(who);
      if (imp === undefined) continue;
      out.push({
        kind: "unseen_clash",
        who,
        others: others(e, who),
        event: e.id,
        weight: round(imp * 0.6),
      });
    }
  }

  // Recuerda el hecho con otra gente de la que estuvo.
  for (const m of memories?.items ?? []) {
    const e = w.log.get(m.eventId);
    if (!e) continue;
    const real = others(e, me);
    const said = [...m.perceived.with].sort(byId);
    if (real.length === 0 || (real.join() === said.join() && m.distortion === 0)) continue;
    const who = real.find((a) => importance.has(a)) ?? said.find((a) => importance.has(a));
    if (who === undefined) continue;
    out.push({
      kind: "misremembered",
      who,
      others: real.filter((a) => a !== who),
      event: e.id,
      believedWith: said,
      weight: round((importance.get(who) ?? 0) * Math.max(m.intensity, 0.2) * 0.8),
    });
  }

  // Una sola entrada por (tipo, evento, persona); las de más peso, primero.
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.weight - a.weight || byNumber(a.event, b.event) || byId(a.who, b.who))
    .filter((x) => {
      const key = `${x.kind}|${x.event}|${x.who}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_NEVER_KNEW);
}
