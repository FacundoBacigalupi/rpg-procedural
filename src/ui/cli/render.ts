// Texto de la CLI: el tiempo que pasa, la línea de estado y los paneles. La narración sale del narrador (con
// plantillas si no hay red, narration §11) desde la `PlayerView`; acá no se lee el mundo.

import { EARTHLIKE_CLOCK, formatTick, type Tick } from "../../core/index.ts";
import type { CharacterPanel, Interrupt, InventoryPanel } from "../../game/index.ts";

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

const PRACTICE: Readonly<Record<CharacterPanel["skills"][number]["practice"], string>> = {
  never_much: "poco",
  some: "algunas veces",
  a_lot: "mucho",
  all_life: "toda la vida",
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
  if (p.family.length > 0) {
    lines.push(`Tu gente: ${p.family.map((f) => `tu ${f.relation}`).join(", ")}.`);
  }
  if (p.skills.length > 0) {
    lines.push("Lo que hiciste en tu vida:");
    for (const s of p.skills) lines.push(`  ${s.name}: ${PRACTICE[s.practice]}`);
  }
  return lines.join("\n");
}

export function renderInventory(p: InventoryPanel): string {
  const lines = [
    p.carried.length === 0
      ? "No llevás nada encima."
      : `Llevás encima: ${p.carried.map((c) => `${AMOUNT[c.amount]} ${c.good}`).join(", ")}.`,
  ];
  if (p.larder.length === 0) lines.push("En la despensa de tu casa no hay nada.");
  for (const l of p.larder) lines.push(`En la despensa: ${l.good}; ${LASTS[l.lasts]}.`);
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
