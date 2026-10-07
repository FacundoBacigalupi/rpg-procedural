// Texto del stub: lo que en la Fase 1 hace el narrador con plantillas (narration §13). Solo lee
// la vista del personaje, nunca el mundo.

import { formatTick, type Tick } from "../../core/index.ts";
import {
  CLOCK,
  HUT_COST,
  type SeenEvent,
  type StubView,
  type TurnReport,
} from "../../game/index.ts";

const UNITS: readonly [number, string, string][] = [
  [CLOCK.day, "día", "días"],
  [3600, "hora", "horas"],
  [60, "minuto", "minutos"],
];

/** "pasan 2 días y 3 horas", "pasa un minuto". */
export function elapsed(seconds: number): string {
  const parts: string[] = [];
  let rest = seconds;
  for (const [size, one, many] of UNITS) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0 && parts.length < 2)
      parts.push(n === 1 ? `un${one === "hora" ? "a" : ""} ${one}` : `${n} ${many}`);
  }
  if (parts.length === 0) return "no pasa nada de tiempo";
  const verb = parts.length === 1 && /^una? /.test(parts[0] as string) ? "Pasa" : "Pasan";
  return `${verb} ${parts.join(" y ")}.`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function amountOf(data: unknown): number {
  return (data as { amount: number }).amount;
}

export function describe(e: SeenEvent): string {
  const [a = "alguien", b = "alguien"] = e.actors;
  switch (e.kind) {
    case "gift": {
      const n = amountOf(e.data);
      const coins = n === 1 ? "una moneda" : `${n} monedas`;
      if (a === "vos") return `Le das ${coins} a ${b}.`;
      if (b === "vos") return `${capital(a)} te regala ${coins}.`;
      return `${capital(a)} le regala ${coins} a ${b}.`;
    }
    case "build":
      return a === "vos" ? "Terminás una choza." : `${capital(a)} levanta una choza.`;
    case "build-failed":
      return `No te alcanzan las monedas para una choza (cuesta ${HUT_COST}).`;
    case "give-failed": {
      const d = e.data as { reason: string; to: string };
      return d.reason === "coins" ? "No tenés tantas monedas." : `No encontrás a ${d.to}.`;
    }
    default:
      return `(${e.kind})`;
  }
}

export function renderView(v: StubView): string {
  const huts = v.huts === 0 ? "ninguna choza" : v.huts === 1 ? "una choza" : `${v.huts} chozas`;
  const people = v.people.length === 0 ? "nadie" : v.people.join(", ");
  return [`Estás en la aldea. Tenés ${v.purse} monedas y ${huts}.`, `Ves a: ${people}.`].join("\n");
}

export function renderStatus(now: Tick, v: StubView): string {
  return `— ${formatTick(CLOCK, now)} · ${v.purse} monedas`;
}

export function renderTurn(r: TurnReport, look: boolean): string {
  const lines = r.seen.map(describe);
  lines.push(elapsed(r.to - r.from));
  if (r.interrupted) lines.push("Te interrumpen.");
  if (look) lines.push(renderView(r.view));
  lines.push(renderStatus(r.to, r.view));
  return lines.join("\n");
}
