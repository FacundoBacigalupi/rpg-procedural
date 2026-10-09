// La crónica como texto, con frases fijas (sin narrador: chronicle §10 llega con el LLM). Todo sale
// de la `Chronicle` estructurada; nada se inventa.

import type { Event, EventId, PlanetClock } from "../../core/index.ts";
import type { Chronicle } from "./chronicle.ts";

const CAUSE: Readonly<Record<string, string>> = {
  exsanguination: "se desangró",
  dehydration: "murió de sed",
  starvation: "murió de hambre",
  sepsis: "murió de una infección que le llegó a la sangre",
  brain_trauma: "murió de un golpe en la cabeza",
  disease: "murió de una enfermedad",
  hypothermia: "murió de frío",
  heatstroke: "murió de un golpe de calor",
  unknown: "murió",
};

const STEP: Readonly<Record<string, string>> = {
  "combat.fight": "una pelea",
  "body.collapsed": "un desmayo",
  "body.wound_infected": "una herida que se infectó",
  "body.wound_healed": "una herida que cerró",
  "law.default": "una deuda que no se pagó",
};

const CLOSER: Readonly<Record<string, string>> = {
  "combat.fight": "hasta una pelea",
  "body.collapsed": "hasta que se desmayó",
  "body.wound_infected": "hasta que una herida se infectó",
  "law.default": "hasta una deuda sin pagar",
  death: "hasta el final",
};

const FELT: Readonly<Record<string, string>> = {
  trust: "confianza",
  respect: "respeto",
  affection: "cariño",
  fear: "miedo",
  attraction: "atracción",
  gratitude: "gratitud",
  jealousy: "celos",
  resentment: "rencor",
  dependency: "dependencia",
};

const GUILT_DEED: Readonly<Record<string, string>> = {
  theft: "Lo que le sacaste a",
  assault: "Lo que le hiciste a",
  default: "Lo que le debías a",
};

const GUILT_STANCE: Readonly<Record<string, string>> = {
  avoid: "preferiste no cruzártelo",
  repair: "quisiste repararlo",
  confess: "quisiste confesarlo",
  deflect: "te diste excusas y buscaste otro culpable",
};

function stepOf(e: Event): string {
  return STEP[e.kind] ?? `lo que hizo (${e.kind.slice(e.kind.indexOf(".") + 1)})`;
}

export function renderChronicle(
  c: Chronicle,
  clock: PlanetClock,
  event: (id: EventId) => Event | undefined,
  nameOf: (id: string) => string,
): string {
  const years = (t: number) => Math.floor(t / clock.year);
  const day = (t: number) => Math.floor((t - c.entered) / clock.day) + 1;
  const marks = [
    ...(c.marks.mode === "novela" ? ["modo novela"] : []),
    ...(c.marks.inspected ? ["con el inspector"] : []),
  ];
  const out: string[] = [
    `${c.name}, ${years(c.died - c.born)} años${marks.length ? ` (${marks.join(", ")})` : ""}`,
    `${c.name} ${CAUSE[c.death.cause] ?? "murió"}.`,
  ];

  const chain = c.death.chain
    .map(event)
    .filter((e): e is Event => e !== undefined)
    .filter((e) => STEP[e.kind] !== undefined || e.kind.startsWith("action."));
  if (chain.length > 0) {
    out.push("", "Cómo se llegó:");
    for (const e of chain.slice(-6)) out.push(`  día ${day(e.tick)}: ${stepOf(e)}`);
  }

  out.push("");
  c.chapters.forEach((ch, i) => {
    const people = ch.title.people.map(nameOf);
    const who = people.length > 0 ? `, con ${people.join(", ")}` : "";
    const span = `días ${day(ch.span.from)}–${day(ch.span.to)}`;
    out.push(`Capítulo ${i + 1} (${span}): ${CLOSER[ch.title.closedBy] ?? "hasta un giro"}${who}.`);
  });
  if (c.people.length > 0) {
    out.push("", "Quienes más pesaron:");
    for (const p of c.people) {
      const felt = p.feltFor.map((d) => FELT[d] ?? d);
      const how = felt.length > 0 ? ` (${felt.join(", ")})` : "";
      out.push(`  ${nameOf(p.who)}${how}${p.alive ? "" : ", que ya había muerto"}`);
    }
  }

  if (c.guilt.length > 0) {
    out.push("", "Lo que cargaste:");
    for (const g of c.guilt) {
      const weight =
        g.guilt < 0.35 ? "un peso leve" : g.guilt < 0.7 ? "un peso grande" : "un peso enorme";
      out.push(
        `  ${GUILT_DEED[g.kind] ?? "Lo que hiciste"} ${nameOf(g.victim)}: ${weight}; ${GUILT_STANCE[g.response]}.`,
      );
    }
  }

  if (c.neverKnew.length > 0) {
    out.push("", "Lo que nunca supiste:");
    for (const u of c.neverKnew) {
      const who = nameOf(u.who);
      const others = u.others.map(nameOf).join(", ");
      const withOthers = others ? ` (con ${others})` : "";
      if (u.kind === "died_unknown") out.push(`  ${who} murió sin que te enteraras${withOthers}.`);
      else if (u.kind === "unseen_clash") {
        out.push(`  ${who} se peleó donde no estabas${withOthers}.`);
      } else {
        const said = (u.believedWith ?? []).map(nameOf).join(", ") || "nadie";
        out.push(`  Recordabas un hecho con ${said}, pero estuvo ${who}${withOthers}.`);
      }
    }
  }
  return out.join("\n");
}
