// El epílogo corto (chronicle §7, Fase 3): el mismo mundo sigue corriendo sin el personaje y, en
// cada punto de control, se anota qué fue de quienes se siguen: la gente que más pesó, el cónyuge,
// los hijos y el hogar. No inventa nada: cada hecho sale de la verdad en ese tick y cita el evento
// de la muerte cuando la hubo. Se corta cuando ya no queda nadie de los seguidos.

import type { AgentId, Event, EventId, Tick } from "../../core/index.ts";
import { compareStrings } from "../../core/index.ts";
import { BODY_STATE, type DeathCause, ENTITY, PERSON } from "../../sim/index.ts";
import type { LifeWorld } from "../life/index.ts";
import type { Chronicle } from "./chronicle.ts";

/** Puntos de control del epílogo corto, en días desde la muerte (el año y los diez años). */
export const EPILOGUE_YEARS: readonly number[] = [1, 10];

export type EpilogueFact =
  | {
      readonly kind: "alive";
      readonly who: AgentId;
      readonly relation: TrackedRelation;
      readonly ageYears: number;
    }
  | {
      readonly kind: "died";
      readonly who: AgentId;
      readonly relation: TrackedRelation;
      readonly at: Tick;
      readonly cause: DeathCause | "unknown";
      readonly event: EventId;
    }
  | { readonly kind: "household"; readonly alive: readonly AgentId[] };

export type TrackedRelation = "spouse" | "child" | "household" | "close";

export interface EpilogueSection {
  readonly at: Tick;
  readonly years: number;
  readonly facts: readonly EpilogueFact[];
  /** Quienes siguen vivos y te conocieron: lo que queda del recuerdo (por ahora, solo ellos). */
  readonly rememberedBy: readonly AgentId[];
  /** Ya no queda nadie de los seguidos: el epílogo se corta acá. */
  readonly ended: boolean;
}

export interface Epilogue {
  readonly fromTick: Tick;
  readonly tracked: readonly AgentId[];
  readonly sections: readonly EpilogueSection[];
}

const byId = (a: AgentId, b: AgentId) => compareStrings(a, b);
const alive = (w: LifeWorld, id: AgentId) => w.truth.get(ENTITY, id)?.endedAt === undefined;

/** A quiénes se sigue, y por qué: cónyuge, hijos, el hogar y los más cercanos de la crónica. */
export function trackedOf(w: LifeWorld, c: Chronicle): Map<AgentId, TrackedRelation> {
  const me = c.subject;
  const mine = w.truth.get(PERSON, me);
  const out = new Map<AgentId, TrackedRelation>();
  const add = (id: AgentId, rel: TrackedRelation) => {
    if (id !== me && !out.has(id)) out.set(id, rel);
  };
  if (mine?.spouse) add(mine.spouse, "spouse");
  const people = [...(w.truth.ids(PERSON) as AgentId[])].sort(byId);
  for (const id of people) {
    const p = w.truth.get(PERSON, id);
    if (p && (p.mother === me || p.father === me)) add(id, "child");
  }
  if (mine) {
    for (const id of people) {
      if (w.truth.get(PERSON, id)?.household === mine.household) add(id, "household");
    }
  }
  for (const p of c.people) add(p.who, "close");
  return out;
}

function deathOf(w: LifeWorld, who: AgentId): Event | undefined {
  return w.log.all().find((e) => e.kind === "body.died" && e.actors.includes(who));
}

/** Qué fue de lo seguido en este momento. Pura sobre la verdad. */
export function epilogueSection(
  w: LifeWorld,
  c: Chronicle,
  tracked: ReadonlyMap<AgentId, TrackedRelation>,
  years: number,
): EpilogueSection {
  const now = w.scheduler.now;
  const facts: EpilogueFact[] = [];
  const living: AgentId[] = [];
  for (const [who, relation] of [...tracked].sort((a, b) => byId(a[0], b[0]))) {
    if (alive(w, who)) {
      living.push(who);
      const born = w.truth.get(PERSON, who)?.born ?? now;
      facts.push({
        kind: "alive",
        who,
        relation,
        ageYears: Math.floor((now - born) / w.clock.year),
      });
      continue;
    }
    const ev = deathOf(w, who);
    if (!ev) continue;
    const cause =
      (ev.data as { cause?: DeathCause } | null)?.cause ??
      w.truth.get(BODY_STATE, who)?.death?.cause ??
      "unknown";
    facts.push({ kind: "died", who, relation, at: ev.tick, cause, event: ev.id });
  }
  const home = w.truth.get(PERSON, c.subject)?.household;
  if (home) {
    const members = (w.truth.ids(PERSON) as AgentId[])
      .filter((id) => w.truth.get(PERSON, id)?.household === home && alive(w, id))
      .sort(byId);
    facts.push({ kind: "household", alive: members });
  }
  return {
    at: now,
    years,
    facts,
    rememberedBy: living,
    ended: living.length === 0,
  };
}

/**
 * Corre el mundo hacia adelante (la misma simulación, sin el personaje) y anota cada punto de
 * control. Se corta cuando ya no queda nadie de los seguidos.
 */
export function runEpilogue(
  w: LifeWorld,
  c: Chronicle,
  checkpoints: readonly number[] = EPILOGUE_YEARS,
): Epilogue {
  const tracked = trackedOf(w, c);
  const sections: EpilogueSection[] = [];
  for (const years of checkpoints) {
    w.scheduler.advanceTo(c.died + Math.round(years * w.clock.year));
    const s = epilogueSection(w, c, tracked, years);
    sections.push(s);
    if (s.ended) break;
  }
  return { fromTick: c.died, tracked: [...tracked.keys()], sections };
}

const REL: Readonly<Record<TrackedRelation, string>> = {
  spouse: "tu pareja",
  child: "tu hijo o hija",
  household: "de tu casa",
  close: "de los que más pesaron",
};

const CAUSE: Readonly<Record<string, string>> = {
  exsanguination: "se desangró",
  dehydration: "murió de sed",
  starvation: "murió de hambre",
  sepsis: "murió de una infección",
  brain_trauma: "murió de un golpe en la cabeza",
  disease: "murió de una enfermedad",
  hypothermia: "murió de frío",
  heatstroke: "murió de un golpe de calor",
  poison: "murió envenenado",
  unknown: "murió",
};

/** El epílogo como texto con frases fijas, igual que la crónica. */
export function renderEpilogue(e: Epilogue, nameOf: (id: string) => string): string {
  const out: string[] = [];
  for (const s of e.sections) {
    out.push(s.years === 1 ? "Un año después:" : `${s.years} años después:`);
    for (const f of s.facts) {
      if (f.kind === "alive") {
        out.push(`  ${nameOf(f.who)} (${REL[f.relation]}) vive, de ${f.ageYears} años.`);
      } else if (f.kind === "died") {
        out.push(`  ${nameOf(f.who)} (${REL[f.relation]}) ${CAUSE[f.cause] ?? "murió"}.`);
      } else if (f.alive.length === 0) {
        out.push("  Tu casa quedó sin nadie.");
      } else {
        out.push(`  En tu casa viven ${f.alive.map(nameOf).join(", ")}.`);
      }
    }
    if (s.ended) out.push("  Ya no queda nadie de los tuyos.");
    out.push("");
  }
  return out.join("\n").trimEnd();
}
