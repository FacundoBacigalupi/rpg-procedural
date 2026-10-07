// Texto de la CLI: el tiempo que pasa y la línea de estado. La narración sale del narrador (con
// plantillas si no hay red, narration §11) desde la `PlayerView`; acá no se lee el mundo.

import { EARTHLIKE_CLOCK, formatTick, type Tick } from "../../core/index.ts";

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
