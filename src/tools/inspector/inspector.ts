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
  type PressureId,
  parseId,
} from "../../core/index.ts";
import { type Life, lifePressures, PERCEPTS, playerView } from "../../game/index.ts";
import {
  BELIEFS,
  beliefConfidenceAt,
  checkInvariants,
  ENTITY,
  isMistaken,
  MEMORIES,
  type Pressure,
  salient,
  truthOf,
} from "../../sim/index.ts";

/** Cuántos eventos lista como máximo cada comando que recorre el registro. */
export const INSPECT_LIMIT = 40;

/** Comandos de sistemas que llegan en fases posteriores: nombre → dónde aparecen. */
const LATER: Readonly<Record<string, string>> = {
  mind: "Fase 2 (npc-psychology)",
  decision: "Fase 3 (decisión de los NPC)",
  believes: "Fase 2 (creencias)",
  rumor: "Fase 3 (información: rumores con linaje)",
};

export const INSPECTOR_HELP = [
  "Inspector (solo lectura; marca la vida como inspeccionada):",
  "  tables · entity <id> · find <texto> · origin <id> · why <evento> · effects <evento>",
  "  timeline [n] · body <agente> · view · ledger <cuenta> · invariants · hash",
  "  memories [agente] · wrong [agente] · percepts [agente] [tick] · rumor <id>",
  "  pressures [tipo] · pressure <tipo> <id> · hazard",
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
    case "pressures":
      return pressures(life, arg);
    case "pressure":
      return args[0] && args[1] ? pressure(life, args[0], args[1]) : "pressure <tipo> <id>";
    case "memories":
      return memories(life, arg ?? life.player);
    case "wrong":
      return wrong(life, arg);
    case "percepts":
      return percepts(life, arg ?? life.player, args[1]);
    case "hazard":
      return hazard(life);
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
  const causes = e.causes
    .map((c) =>
      c.kind === "event"
        ? c.event
        : c.kind === "pressure"
          ? `${c.pressure}=${(c.weight ?? 0).toFixed(2)}`
          : c.kind,
    )
    .join(", ");
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

function pressureLine(p: Pressure): string {
  const trend = p.trend === 0 ? "" : ` (${p.trend > 0 ? "sube" : "baja"})`;
  return `${p.kind}@${p.scope.ref} ${p.value.toFixed(2)}${trend}`;
}

function pressures(life: Life, kind: string | undefined): string {
  const rows = lifePressures(life.world).filter((p) => !kind || p.kind === kind);
  if (rows.length === 0) return kind ? `No hay presiones de tipo ${kind}.` : "No hay presiones.";
  return rows
    .sort((a, b) => b.value - a.value)
    .map(pressureLine)
    .join("\n");
}

function pressure(life: Life, kind: string, id: string): string {
  const p = lifePressures(life.world).find((x) => x.kind === kind && x.scope.ref === id);
  if (!p) return `No hay una presión ${kind} en ${id}.`;
  return [
    pressureLine(p),
    ...(p.id ? [dischargeHistory(life, p.id)] : ["nunca la citó un evento."]),
    `calculada por ${p.system}; fuentes:`,
    ...p.sources.map((s) => `  ${s.kind === "state" ? `${s.entity}.${s.key}` : s.kind}`),
    p.discharges.length ? "descargas:" : "sin descargas posibles todavía (ningún proceso la usa).",
    ...p.discharges.map((d) => `  ${d.process}: umbral ${d.threshold}, hazard ${d.hazard}`),
  ].join("\n");
}

/** Cada evento que la citó, con el valor que tenía en ese momento. */
function dischargeHistory(life: Life, id: PressureId): string {
  const rows = life.world.log
    .all()
    .flatMap((e) => e.causes.map((c) => ({ e, c })))
    .filter(({ c }) => c.kind === "pressure" && c.pressure === id)
    .map(({ e, c }) => {
      const value = c.kind === "pressure" ? (c.weight ?? 0) : 0;
      return `  t${e.tick} ${e.id} ${e.kind} con valor ${value.toFixed(2)}`;
    });
  return [`${id}: citada por ${rows.length} eventos:`, ...rows.slice(-INSPECT_LIMIT)].join("\n");
}

function hazard(life: Life): string {
  const rows = lifePressures(life.world).flatMap((p) => p.discharges.map((d) => ({ p, d })));
  if (rows.length === 0) return "Ninguna presión tiene descargas posibles todavía.";
  return rows
    .sort((a, b) => b.d.hazard - a.d.hazard)
    .map(({ p, d }) => `${d.process} ← ${pressureLine(p)}: hazard ${d.hazard.toFixed(4)}`)
    .join("\n");
}

function agentArg(life: Life, id: string): AgentId | undefined {
  const r = ref(id);
  return r?.startsWith("agent:") && life.world.truth.has(ENTITY, r) ? (r as AgentId) : undefined;
}

const f2 = (x: number) => x.toFixed(2);

/** Lo que cree que pasó contra lo que pasó (recuerdo vs evento real). */
function memories(life: Life, id: string): string {
  const who = agentArg(life, id);
  if (!who) return `No hay un agente ${id}.`;
  const mem = life.world.truth.get(MEMORIES, who);
  if (!mem || (mem.items.length === 0 && mem.gists.length === 0))
    return `${who} no guarda memorias.`;
  const now = life.now;
  const rows = salient(mem, now).map(({ memory: m, salience }) => {
    const real = life.world.log.get(m.eventId);
    const differs = real && real.kind !== m.perceived.kind ? ` (real: ${real.kind})` : "";
    return (
      `${m.eventId} t${m.at} ${m.perceived.kind}${differs} con [${m.perceived.with.join(" ")}] ` +
      `${m.source}${m.toldBy ? ` de ${m.toldBy}` : ""} intensidad ${f2(m.intensity)} ` +
      `valencia ${f2(m.valence)} confianza ${f2(m.confidence)} distorsión ${f2(m.distortion)} ` +
      `saliencia ${f2(salience)} recordada ${m.recalls}x`
    );
  });
  const gists = mem.gists.map(
    (g) =>
      `resumen ${g.kind} con [${g.with.join(" ")}]: ${g.count}x, valencia ${f2(g.valence)}, ` +
      `pico ${f2(g.peak)}, t${g.first}-t${g.last}, causas ${g.causes.join(" ")}`,
  );
  return [`${who}: ${mem.items.length} memorias, ${mem.gists.length} resúmenes`, ...rows, ...gists]
    .slice(0, INSPECT_LIMIT * 2)
    .join("\n");
}

/** Creencias falsas con su origen; sin argumento, cuántas tiene cada uno. */
function wrong(life: Life, id: string | undefined): string {
  const truth = life.world.truth;
  const now = life.now;
  if (!id) {
    const rows = truth
      .ids(BELIEFS)
      .map((h) => {
        const items = truth.get(BELIEFS, h)?.items ?? [];
        return { h, bad: items.filter((b) => isMistaken(truth, b)).length, all: items.length };
      })
      .filter((r) => r.bad > 0)
      .sort((a, b) => b.bad - a.bad || (a.h < b.h ? -1 : 1));
    return rows.length === 0
      ? "Nadie cree nada falso."
      : rows
          .slice(0, INSPECT_LIMIT)
          .map((r) => `${r.h}: ${r.bad} falsas de ${r.all}`)
          .join("\n");
  }
  const who = agentArg(life, id);
  if (!who) return `No hay un agente ${id}.`;
  const items = truth.get(BELIEFS, who)?.items ?? [];
  const bad = items.filter((b) => isMistaken(truth, b));
  if (bad.length === 0) return `${who} no cree nada falso (${items.length} creencias).`;
  return [
    `${who}: ${bad.length} falsas de ${items.length}`,
    ...bad.map((b) => {
      const src = b.sources
        .map((s) =>
          s.kind === "percept"
            ? `percept ${s.percept} t${s.tick}`
            : s.kind === "told"
              ? `dicho por ${s.from} t${s.tick}`
              : `razonado de ${s.evidence.join(", ") || "nada citado"} t${s.tick}`,
        )
        .join("; ");
      return (
        `${b.prop.subject}.${b.prop.attr}: cree ${JSON.stringify(b.value)}, es ` +
        `${JSON.stringify(truthOf(truth, b))}; confianza ${f2(beliefConfidenceAt(b, now))}, ` +
        `de t${b.asOf}; fuentes: ${src || "ninguna"}`
      );
    }),
  ].join("\n");
}

/** Los percepts guardados del personaje, con lo que se leyó mal. Los NPC todavía no perciben. */
function percepts(life: Life, id: string, from: string | undefined): string {
  const who = agentArg(life, id);
  if (!who) return `No hay un agente ${id}.`;
  const recent = life.world.truth.get(PERCEPTS, who)?.recent;
  if (!recent) {
    return who === life.player
      ? "El personaje no percibió nada todavía."
      : `${who} no guarda percepts: los NPC todavía no perciben (Fase 3, decisión de los NPC).`;
  }
  const since = from !== undefined && Number.isFinite(Number(from)) ? Number(from) : 0;
  const rows = recent
    .filter((p) => p.tick >= since)
    .map((p) => {
      const fields = Object.entries(p.fields)
        .map(
          ([k, v]) =>
            `${k}=${JSON.stringify(v.value)}(${f2(v.confidence)}${v.mistaken ? ", FALSO" : ""})`,
        )
        .join(" ");
      return `${p.id} t${p.tick} ${p.detail} por ${p.channels.join("+")} de ${
        p.sourceEventId ?? p.sourceEntityId ?? "?"
      }: ${fields}`;
    });
  return rows.length === 0 ? `${who} no tiene percepts desde t${since}.` : rows.join("\n");
}

export type { AgentId };
