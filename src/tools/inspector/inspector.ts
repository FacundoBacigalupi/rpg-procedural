// Inspector god-mode básico (tooling §5), de solo lectura: lee la `Life` sin escribir nada (el
// hash no cambia después de usarlo, y eso lo prueba el test). Cada comando devuelve texto para la
// CLI. Los comandos de sistemas que todavía no existen (`mind`, `decision`, `believes`…) dicen de
// qué fase son en vez de inventar una respuesta.

import {
  type AgentId,
  type EntityRef,
  type Event,
  type EventId,
  isExternal,
  type LedgerAccount,
  ledgerUnit,
  parseId,
} from "../../core/index.ts";
import { type Life, playerView } from "../../game/index.ts";
import { checkInvariants, ENTITY } from "../../sim/index.ts";

/** Cuántos eventos lista como máximo cada comando que recorre el registro. */
export const INSPECT_LIMIT = 40;

/** Comandos de sistemas que llegan en fases posteriores: nombre → dónde aparecen. */
const LATER: Readonly<Record<string, string>> = {
  mind: "Fase 2 (npc-psychology)",
  decision: "Fase 3 (decisión de los NPC)",
  memories: "Fase 2 (memorias)",
  believes: "Fase 2 (creencias)",
  wrong: "Fase 2 (creencias)",
  percepts: "Fase 2 (percepts de los NPC)",
  pressures: "Hito 1a (Pressure como objeto)",
  pressure: "Hito 1a (Pressure como objeto)",
  hazard: "Hito 1a (Pressure como objeto)",
  rumor: "Fase 2 (información)",
};

export const INSPECTOR_HELP = [
  "Inspector (solo lectura; marca la vida como inspeccionada):",
  "  tables · entity <id> · find <texto> · origin <id> · why <evento> · effects <evento>",
  "  timeline [n] · body <agente> · view · ledger <cuenta> · invariants · hash",
].join("\n");

export function inspect(life: Life, line: string): string {
  const [cmd = "", ...args] = line.trim().split(/\s+/);
  const arg = args[0];
  switch (cmd.toLowerCase()) {
    case "":
    case "help":
    case "ayuda":
      return INSPECTOR_HELP;
    case "tables":
      return tables(life);
    case "entity":
      return arg ? entity(life, arg) : "entity <id>";
    case "find":
      return args.length ? find(life, args.join(" ")) : "find <texto>";
    case "origin":
      return arg ? origin(life, arg) : "origin <id>";
    case "why":
      return arg ? cone(life, arg, "why") : "why <evento>";
    case "effects":
      return arg ? cone(life, arg, "effects") : "effects <evento>";
    case "timeline":
      return timeline(life, Number(arg ?? INSPECT_LIMIT));
    case "body":
      return arg ? component(life, arg, "body.state") : component(life, life.player, "body.state");
    case "view":
      return show(playerView(life.world, [], {}));
    case "ledger":
      return arg ? ledgerOf(life, arg) : "ledger <cuenta>";
    case "invariants":
      return invariants(life);
    case "hash":
      return show(life.hash());
    default: {
      const later = LATER[cmd.toLowerCase()];
      return later
        ? `«${cmd}» todavía no existe: llega con ${later}.`
        : `Comando desconocido: ${cmd}. Escribí «help».`;
    }
  }
}

function show(value: unknown): string {
  return JSON.stringify(value, null, 1);
}

function ref(id: string): EntityRef | undefined {
  return parseId(id) ? (id as EntityRef) : undefined;
}

function tables(life: Life): string {
  const truth = life.world.truth;
  return truth
    .tables()
    .map((t) => `${t}: ${truth.ids({ name: t }).length}`)
    .join("\n");
}

function entity(life: Life, id: string): string {
  const r = ref(id);
  const truth = life.world.truth;
  if (!r || !truth.has(ENTITY, r)) return `No hay una entidad ${id}.`;
  const out = [`${r}`];
  for (const t of truth.tables()) {
    if (truth.hasRaw(t, r)) out.push(`# ${t}\n${show(truth.getRaw(t, r))}`);
  }
  return out.join("\n");
}

function component(life: Life, id: string, table: string): string {
  const r = ref(id);
  if (!r || !life.world.truth.hasRaw(table, r)) return `${id} no tiene ${table}.`;
  return show(life.world.truth.getRaw(table, r));
}

function find(life: Life, text: string): string {
  const needle = text.toLowerCase();
  const truth = life.world.truth;
  const hits: string[] = [];
  for (const id of truth.ids(ENTITY)) {
    if (id.includes(needle)) {
      hits.push(id);
      continue;
    }
    const matched = truth.tables().find((t) => {
      const v = truth.getRaw(t, id);
      return (
        v !== undefined && t !== ENTITY.name && JSON.stringify(v).toLowerCase().includes(needle)
      );
    });
    if (matched) hits.push(`${id} (${matched})`);
  }
  if (hits.length === 0) return `Nada coincide con «${text}».`;
  const shown = hits.slice(0, INSPECT_LIMIT);
  return [
    ...shown,
    ...(hits.length > shown.length ? [`… y ${hits.length - shown.length} más`] : []),
  ].join("\n");
}

function line(e: Event): string {
  const causes = e.causes.map((c) => (c.kind === "event" ? c.event : c.kind)).join(", ");
  return `${e.id} t${e.tick} ${e.kind} [${e.actors.join(" ")}] ← ${causes}`;
}

function origin(life: Life, id: string): string {
  const r = ref(id);
  const base = r ? life.world.truth.get(ENTITY, r) : undefined;
  if (!base) return `No hay una entidad ${id}.`;
  const e = life.world.log.get(base.originEventId);
  const ended = base.endEventId ? life.world.log.get(base.endEventId) : undefined;
  return [
    `${id} nace en t${base.createdAt} por:`,
    e ? line(e) : `${base.originEventId} (no está en el registro)`,
    ...(ended ? ["y termina por:", line(ended)] : []),
  ].join("\n");
}

function cone(life: Life, id: string, way: "why" | "effects"): string {
  const log = life.world.log;
  if (!log.has(id as EventId)) return `No hay un evento ${id}.`;
  const ids = way === "why" ? log.ancestors(id as EventId) : log.descendants(id as EventId);
  if (ids.length === 0)
    return way === "why" ? `${id} no depende de otro evento.` : `${id} no causó nada.`;
  const rows = ids.slice(-INSPECT_LIMIT).map((e) => line(log.get(e) as Event));
  const cut = ids.length - rows.length;
  return [
    `${line(log.get(id as EventId) as Event)}`,
    way === "why" ? "depende de:" : "causó:",
    ...(cut > 0 ? [`… ${cut} anteriores`] : []),
    ...rows,
  ].join("\n");
}

function timeline(life: Life, n: number): string {
  const all = life.world.log.all();
  const count = Number.isInteger(n) && n > 0 ? n : INSPECT_LIMIT;
  return all.slice(-count).map(line).join("\n") || "El registro está vacío.";
}

function ledgerOf(life: Life, account: string): string {
  const acct = account as LedgerAccount;
  const rows = life.world.ledger.holdings(acct);
  if (rows.length === 0)
    return `${account} no tiene nada${isExternal(acct) ? " (cuenta externa)" : ""}.`;
  return rows
    .map(
      (r) =>
        `${r.unit}: ${r.amount} (total en el mundo: ${life.world.ledger.total(ledgerUnit(r.unit))})`,
    )
    .join("\n");
}

function invariants(life: Life): string {
  const problems = checkInvariants({
    truth: life.world.truth,
    log: life.world.log,
    ledger: life.world.ledger,
  });
  return problems.length === 0
    ? "Sin violaciones."
    : [`${problems.length} violaciones:`, ...problems.slice(0, INSPECT_LIMIT)].join("\n");
}

export type { AgentId };
