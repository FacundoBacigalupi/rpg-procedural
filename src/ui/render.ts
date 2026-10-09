// Texto de la CLI: el tiempo que pasa, la línea de estado y los paneles. La narración sale del narrador (con
// plantillas si no hay red, narration §11) desde la `PlayerView`; acá no se lee el mundo.

import { EARTHLIKE_CLOCK, formatTick, type Tick } from "../core/index.ts";
import {
  type AboutPanel,
  type BookLine,
  type BookPanel,
  type CharacterPanel,
  type EnvironmentItem,
  type HypothesesPanel,
  type Interrupt,
  type InventoryPanel,
  type Suggestion,
  type ThinkResult,
  TONE_MARK,
} from "../game/index.ts";
import type { Fact, PurposeId } from "../sim/index.ts";

const UNITS: readonly [number, string, string][] = [
  [EARTHLIKE_CLOCK.day, "día", "días"],
  [3600, "hora", "horas"],
  [60, "minuto", "minutos"],
];

/** "Pasan 2 días y 3 horas.", "Pasa un minuto." */
export function elapsed(seconds: number): string {
  const parts: string[] = [];
  let rest = seconds;
  for (const [size, one, many] of UNITS) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0 && parts.length < 2) {
      parts.push(n === 1 ? `un${one === "hora" ? "a" : ""} ${one}` : `${n} ${many}`);
    }
  }
  if (parts.length === 0) return "No pasa nada de tiempo.";
  const verb = parts.length === 1 && /^una? /.test(parts[0] as string) ? "Pasa" : "Pasan";
  return `${verb} ${parts.join(" y ")}.`;
}

export function renderStatus(now: Tick): string {
  return `— ${formatTick(EARTHLIKE_CLOCK, now)}`;
}

/** Quita las marcas `{{e1|tu madre}}` de la narración: queda el texto que se lee. */
export function plain(text: string): string {
  return text.replace(/\{\{[^|}]*\|([^}]*)\}\}/g, "$1");
}

// --- Paneles (player-loop §9): el texto de lo que arma `game` sin números de la verdad ---

const SIGNS: Readonly<Record<string, string>> = {
  pale: "estás pálido",
  dizzy: "la cabeza te da vueltas",
  thirsty: "tenés sed",
  parched: "tenés la boca seca de sed",
  hungry: "tenés hambre",
  starving: "el hambre ya te debilita",
  wasting: "estás flaco, se te van las fuerzas",
  tired: "estás cansado",
  exhausted: "estás agotado",
  sleepy: "tenés sueño",
  feverish: "tenés fiebre",
  limping: "rengueás",
  bleeding: "sangra",
  bleeding_heavily: "sangra mucho",
  in_pain: "duele",
  wound_hot: "la herida está caliente",
  bone_broken: "algo está roto",
};

const STANDING: Readonly<Record<CharacterPanel["skills"][number]["standing"], string>> = {
  hardly: "casi nada",
  novice: "recién empezás",
  competent: "te defendés",
  skilled: "sabés bastante",
  master: "sos de los buenos",
};

const FAITH_BELIEF: Readonly<Record<NonNullable<CharacterPanel["faith"]>["belief"], string>> = {
  none: "no creés en nada de eso",
  faint: "dudás de lo que enseñan",
  firm: "creés en lo que enseñan",
  deep: "creés a fondo en lo que enseñan",
};

const FAITH_PRACTICE: Readonly<Record<NonNullable<CharacterPanel["faith"]>["practice"], string>> = {
  none: "no cumplís nada",
  faint: "cumplís poco",
  firm: "cumplís lo que toca",
  deep: "no fallás en ninguna práctica",
};

const FAITH_BELONGING: Readonly<Record<NonNullable<CharacterPanel["faith"]>["belonging"], string>> =
  {
    none: "te sentís ajeno a los demás fieles",
    faint: "te sentís apenas parte",
    firm: "te sentís parte",
    deep: "te sentís uno con la gente de tu fe",
  };

const AMOUNT: Readonly<Record<InventoryPanel["carried"][number]["amount"], string>> = {
  a_little: "un poco de",
  some: "algo de",
  plenty: "bastante",
};

const LASTS: Readonly<Record<InventoryPanel["larder"][number]["lasts"], string>> = {
  empty: "casi no queda",
  days: "alcanza para unos días",
  weeks: "alcanza para unas semanas",
  months: "alcanza para unos meses",
  a_year: "alcanza hasta la próxima cosecha",
};

const BURDEN: Readonly<
  Record<"trauma" | "guilt", Readonly<Record<"light" | "heavy" | "crushing", string>>>
> = {
  trauma: {
    light: "Un sobresalto te queda dentro",
    heavy: "Lo que viviste te sigue de cerca",
    crushing: "Lo que viviste no te deja en paz",
  },
  guilt: {
    light: "Algo que hiciste te roza la conciencia",
    heavy: "Cargás con algo que hiciste",
    crushing: "Lo que hiciste te aplasta",
  },
};

const DEED: Readonly<Record<string, string>> = {
  theft: "Lo que le sacaste",
  assault: "Lo que le hiciste",
  default: "Lo que le debés",
};

const STANCE: Readonly<Record<"none" | "avoid" | "repair" | "confess" | "deflect", string>> = {
  none: "lo dejás pasar",
  avoid: "preferís no cruzártelo",
  repair: "querés repararlo",
  confess: "querés confesarlo",
  deflect: "te das excusas y buscás otro culpable",
};

export function renderCharacter(p: CharacterPanel): string {
  const lines = [
    `Tenés ${p.ageYears} años. ${p.where.home ? "Estás en tu casa." : "Estás fuera de tu casa."}`,
  ];
  const general = p.body.general.map((s) => SIGNS[s] ?? s);
  const zones = p.body.zones.map(
    (z) => `${z.zone}: ${z.signs.map((s) => SIGNS[s] ?? s).join(", ")}`,
  );
  lines.push(
    general.length + zones.length === 0
      ? "Te sentís bien."
      : `Cómo te sentís: ${[...general, ...zones].join("; ")}.`,
  );
  if (p.status !== undefined) lines.push(`En la aldea sos ${p.status}.`);
  if (p.family.length > 0) {
    lines.push(`Tu gente: ${p.family.map((f) => `tu ${f.relation}`).join(", ")}.`);
  }
  const taste = (stances: readonly string[]) =>
    p.tastes.filter((t) => stances.includes(t.stance)).map((t) => t.name);
  const liked = taste(["loves", "likes"]);
  const disliked = taste(["dislikes", "loathes"]);
  if (liked.length > 0) lines.push(`Te gusta: ${liked.join(", ")}.`);
  if (disliked.length > 0) lines.push(`No te gusta: ${disliked.join(", ")}.`);
  if (p.faith) {
    const f = p.faith;
    lines.push(
      `Tu fe (${f.religion}): ${FAITH_BELIEF[f.belief]}; ${FAITH_PRACTICE[f.practice]}; ${FAITH_BELONGING[f.belonging]}.`,
    );
    if (f.practices.length > 0) {
      lines.push(`Lo que se hace: ${f.practices.map((x) => x.name).join(", ")}.`);
    }
  }
  if (p.conscience) {
    for (const b of p.conscience.burdens) lines.push(`${BURDEN[b.kind][b.weight]}.`);
    for (const g of p.conscience.guilt) {
      lines.push(`${DEED[g.deed] ?? "Lo que hiciste"} (${g.other}): ${STANCE[g.stance]}.`);
    }
  }
  if (p.skills.length > 0) {
    lines.push("Lo que creés saber hacer:");
    for (const s of p.skills) {
      lines.push(`  ${s.name}: ${STANDING[s.standing]}${s.sure ? "" : " (o eso creés)"}`);
    }
  }
  return lines.join("\n");
}

export function renderInventory(p: InventoryPanel): string {
  const lines = [
    p.carried.length === 0
      ? "No llevás nada encima."
      : `Llevás encima: ${p.carried.map((c) => `${AMOUNT[c.amount]} ${c.good}`).join(", ")}.`,
  ];
  lines.push(
    p.coins === 0
      ? "No tenés monedas."
      : `Tenés ${p.coins} ${p.coins === 1 ? "moneda" : "monedas"} de cobre.`,
  );
  if (p.larder.length === 0) lines.push("En la despensa de tu casa no hay nada.");
  for (const l of p.larder) lines.push(`En la despensa: ${l.good}; ${LASTS[l.lasts]}.`);
  return lines.join("\n");
}

const SURETY: Readonly<Record<BookLine["sure"], string>> = {
  sure: "",
  unsure: " (no estás del todo seguro)",
  vague: " (lo recordás vagamente)",
};

function dueText(days: number | null): string {
  if (days === null) return "sin plazo que recuerdes";
  if (days === 0) return "para hoy";
  if (days > 0) return days === 1 ? "para mañana" : `en ${days} días`;
  return days === -1 ? "vencida desde ayer" : `vencida hace ${-days} días`;
}

function bookWhat(w: BookLine["what"]): string {
  if (w.kind === "coins") return `${w.coins} ${w.coins === 1 ? "moneda" : "monedas"} de cobre`;
  if (w.kind === "good") return `${AMOUNT[w.amount]} ${w.good}`;
  if (w.kind === "favor") return `un favor (${w.what})`;
  return `silencio sobre ${w.about}`;
}

/** El libro de deudas y promesas (contracts §14): lo que debés primero, lo que te deben después. */
export function renderBook(p: BookPanel): string {
  if (p.lines.length === 0)
    return "No le debés nada a nadie ni nadie te debe a vos, que recuerdes.";
  const lines: string[] = [];
  for (const dir of ["i-owe", "owed-to-me"] as const) {
    const mine = p.lines.filter((l) => l.direction === dir);
    if (mine.length === 0) continue;
    lines.push(dir === "i-owe" ? "Lo que debés:" : "Lo que te deben:");
    for (const l of mine) {
      const how = l.kind === "debt" ? "fiado" : "palabra dada";
      const late = l.defaulted ? "; ya está en mora" : "";
      lines.push(
        `  ${l.other}: ${bookWhat(l.what)}, ${dueText(l.dueInDays)} (${how}${late})${SURETY[l.sure]}`,
      );
    }
  }
  return lines.join("\n");
}

const PURPOSE_TEXT: Readonly<Record<PurposeId, string>> = {
  sustenance: "conseguir de comer",
  gift: "hacer un regalo",
  payment: "pagar lo que debe",
  gain: "sacar provecho",
  theft: "quedarse con lo ajeno",
  harm: "hacer daño",
  defense: "defenderse",
  revenge: "vengarse",
  help: "ayudar",
  curiosity: "curiosear",
  concealment: "ocultar algo",
  devotion: "cumplir con su fe",
  duty: "cumplir con su deber",
};

const ABOUT_SURETY: Readonly<Record<AboutPanel["aliveSurety"], string>> = {
  sure: "",
  unsure: " (no del todo seguro)",
  vague: " (vagamente)",
};

/** «Qué sé de X»: lo que cree de esa persona o cosa y lo que le toca del libro. */
export function renderAbout(p: AboutPanel): string {
  const lines: string[] = [];
  if (p.kind === "person") {
    if (p.alive === "dead") lines.push(`Creés que ${p.name} murió${ABOUT_SURETY[p.aliveSurety]}.`);
    else if (p.alive === "alive")
      lines.push(`Creés que ${p.name} está vivo${ABOUT_SURETY[p.aliveSurety]}.`);
    if (p.where.state === "here") lines.push(`Lo tenés a la vista, acá.`);
    else if (p.where.state === "elsewhere") {
      const d = p.where.daysAgo;
      const when = d === 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`;
      lines.push(
        `La última vez que lo viste no estaba acá, fue ${when}${ABOUT_SURETY[p.where.surety]}.`,
      );
    } else lines.push("No sabés dónde anda.");
    if (p.purpose !== undefined)
      lines.push(
        `Por lo que le viste hacer, te parece que anda por ${PURPOSE_TEXT[p.purpose.motive]}${ABOUT_SURETY[p.purpose.surety]}.`,
      );
  } else if (p.where.state === "here") lines.push(`Estás en ${p.name}.`);
  else lines.push(`Conocés ${p.name}, pero no tenés más para decir.`);
  const owe = p.book.filter((l) => l.direction === "i-owe");
  const owed = p.book.filter((l) => l.direction === "owed-to-me");
  const entry = (l: BookLine) => {
    const how = l.kind === "debt" ? "fiado" : "palabra dada";
    const late = l.defaulted ? "; ya está en mora" : "";
    return `  ${bookWhat(l.what)}, ${dueText(l.dueInDays)} (${how}${late})${SURETY[l.sure]}`;
  };
  if (owe.length > 0) lines.push("Le debés:", ...owe.map(entry));
  if (owed.length > 0) lines.push("Te debe:", ...owed.map(entry));
  return lines.join("\n");
}

const INTERRUPTS: Readonly<Record<Interrupt["kind"], string>> = {
  attacked: "Algo te saca de lo que hacías: te atacan.",
  spoken_to: "Algo te saca de lo que hacías: te hablan.",
  body_alarm: "Dejás lo que hacías: algo en tu cuerpo no anda bien.",
  death_seen: "Dejás lo que hacías: alguien de los tuyos acaba de morir delante tuyo.",
};

export function renderInterrupt(i: Interrupt): string {
  return INTERRUPTS[i.kind];
}

export function renderJournal(entries: readonly { tick: Tick; text: string }[]): string {
  if (entries.length === 0) return "La bitácora está vacía.";
  return entries.map((e) => `${renderStatus(e.tick)}\n${e.text}`).join("\n\n");
}

// --- Opciones sugeridas y entorno (player-loop, ampliación 2026-10-08) ---
// Las etiquetas salen de plantillas; con red las redactaría el narrador con lista blanca.

const SUGGESTION_LABELS: Readonly<Record<Suggestion["kind"], string>> = {
  drink: "Beber",
  eat: "Comer",
  tend: "Atenderte la herida",
  sleep: "Dormir hasta que amanezca",
  rest: "Descansar una hora",
  work: "Trabajar unas horas",
  talk: "Hablar con",
  look: "Mirar alrededor",
  wait: "Esperar una hora",
};

export function renderSuggestion(s: Suggestion): string {
  const label = SUGGESTION_LABELS[s.kind];
  return s.with === undefined ? label : `${label} tu ${s.with}`;
}

/** La opción con su marca de tono para la CLI (`[?]`, `[!]`, `[~]`, `[x]`); las corrientes van sin marca. */
export function renderSuggestionMarked(s: Suggestion): string {
  const mark = TONE_MARK[s.tone];
  return mark === "" ? renderSuggestion(s) : `${mark} ${renderSuggestion(s)}`;
}

const ENVIRONMENT: Readonly<Record<EnvironmentItem["kind"], string>> = {
  dark: "está oscuro",
  dim: "hay poca luz",
  bright: "hay mucha luz",
  rain: "se oye la lluvia",
  snow: "cae nieve",
  wind: "se oye el viento",
  freezing: "hace un frío que duele",
  cold: "hace frío",
  cool: "está fresco",
  warm: "hace calor",
  hot: "el calor aprieta",
};

const CHANNEL_NAMES: Readonly<Record<EnvironmentItem["channel"], string>> = {
  sight: "vista",
  hearing: "oído",
  touch: "tacto",
  smell: "olfato",
};

export function renderEnvironment(items: readonly EnvironmentItem[]): string {
  if (items.length === 0) return "Nada te llama la atención del lugar.";
  return items.map((i) => `${CHANNEL_NAMES[i.channel]}: ${ENVIRONMENT[i.kind]}`).join("\n");
}

// --- Diario de hipótesis (discovery §14): lo que el personaje cree de cómo anda el mundo ---

const CONFIDENCE: Readonly<
  Record<HypothesesPanel["laws"][number]["hypotheses"][number]["confidence"], string>
> = {
  doubtful: "lo dudás mucho",
  possible: "puede ser",
  likely: "lo creés bastante",
  near_certain: "estás casi seguro",
};

const SEASONS = ["la primavera", "el verano", "el otoño", "el invierno"];
const MOONS = ["la luna nueva", "la luna creciente", "la luna llena", "la luna menguante"];
const OUTCOMES = { poor: "poco", fair: "algo", good: "mucho" } as const;

function claimText(c: HypothesesPanel["laws"][number]["hypotheses"][number]["claim"]): string {
  if (c.kind === "none") return "no depende de nada: es cuestión de suerte";
  if (c.kind === "moral") return "es cosa del Cielo, que da y quita según se lo merezca uno";
  const names = c.on === "season" ? SEASONS : MOONS;
  const [a, b] = c.high.map((k) => names[k] ?? "?");
  return c.on === "season"
    ? `rinde más entre ${a} y ${b}`
    : `rinde más entre ${a} y ${b}, y menos en el resto del ciclo`;
}

const SOURCE = { tradition: "", own: " (se te ocurrió a vos)", yours: " (la propusiste)" } as const;

export function renderHypotheses(p: HypothesesPanel): string {
  if (p.laws.length === 0) return "Todavía no te pusiste a pensar cómo anda el mundo.";
  const lines: string[] = [];
  for (const l of p.laws) {
    lines.push(`Lo que rinde el campo (lo viste ${l.seen} ${l.seen === 1 ? "vez" : "veces"}):`);
    for (const h of l.hypotheses) {
      lines.push(`  ${CONFIDENCE[h.confidence]}: ${claimText(h.claim)}${SOURCE[h.source]}`);
    }
    if (l.recent.length > 0) {
      const seen = l.recent.map((o) => {
        const when = [
          o.season === undefined ? undefined : `en ${SEASONS[o.season]}`,
          o.moon === undefined ? undefined : `con ${MOONS[o.moon]}`,
        ].filter((x) => x !== undefined);
        return `${OUTCOMES[o.outcome]}${when.length > 0 ? ` ${when.join(" ")}` : ""}`;
      });
      lines.push(`  Lo último que anotaste: ${seen.join("; ")}.`);
    }
    if (l.anomalies > 0) {
      lines.push(`  Hubo ${l.anomalies} ${l.anomalies === 1 ? "vez" : "veces"} en que no cuadró.`);
    }
  }
  return lines.join("\n");
}

const BAND = {
  convinced: "Estás convencido de que",
  likely: "Lo más probable es que",
  maybe: "Quizá",
  hunch: "Tenés una corazonada: tal vez",
} as const;

/** Cómo se dice cada hecho del catálogo de inferencias (los ids los pone `name`). */
function factText(f: Fact, name: (id: string) => string): string {
  const [a = "", b = ""] = f.args;
  switch (f.pred) {
    case "took":
      return `${name(a)} se llevó ${name(b)}`;
    case "wronged":
      return `${name(a)} fue perjudicado por ${name(b)}`;
    case "poisoned_by":
      return `${name(a)} fue envenenado por ${name(b)}`;
    case "fire_at":
      return `hay fuego en ${name(a)}`;
    case "endangered":
      return `${name(a)} corre peligro`;
    case "at":
      return `${name(a)} está en otro lado`;
    case "alive":
      return `${name(a)} sigue vivo`;
    case "dead":
      return `${name(a)} murió`;
    default:
      return `${f.pred.replace(/_/g, " ")} (${f.args.map(name).join(", ")})`;
  }
}

/** El comando «pensar sobre X»: lo que concluye, con su seguridad, y cómo está al pensarlo. */
export function renderThinking(
  r: ThinkResult,
  topic: string,
  name: (id: string) => string,
): string {
  const lines: string[] = [];
  if (r.state.tired) lines.push("Estás cansado y te cuesta encadenar ideas.");
  if (r.state.afraid) lines.push("Todavía tenés el susto encima y todo te parece peor.");
  if (r.thoughts.length === 0) {
    lines.push(
      r.evidence === 0
        ? `No tenés mucho con qué pensar sobre ${topic}.`
        : `Le das vueltas a ${topic} y no se te ocurre nada que no supieras.`,
    );
  }
  for (const t of r.thoughts) {
    const rival = t.rival === undefined ? "" : ` (o tal vez ${factText(t.rival, name)})`;
    lines.push(`${BAND[t.band]} ${factText(t.fact, name)}${rival}.`);
  }
  return lines.join("\n");
}
