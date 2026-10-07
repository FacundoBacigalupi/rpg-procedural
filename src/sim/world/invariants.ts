// Invariantes causales de la verdad (causality §1 y Tests, tooling §8): sin huérfanos, causas
// válidas y conservación. Para los tests y el modo debug: devuelven las violaciones, no tiran, así
// el que llama decide si detener la corrida y armar el paquete de reproducción.
//
// Las causas que citan presiones se validan contra su registro (`PRESSURE`); las que citan
// creencias, cuando exista sim/knowledge.

import type { EntityRef, Event, EventLog, Ledger } from "../../core/index.ts";
import { PRESSURE } from "./pressure-record.ts";
import { ENTITY, type WorldTruth } from "./truth.ts";

export interface InvariantInput {
  readonly truth: WorldTruth;
  readonly log: EventLog;
  readonly ledger?: Ledger;
}

export function checkInvariants({ truth, log, ledger }: InvariantInput): string[] {
  const problems: string[] = [];

  // Ley 1: toda entidad sale de un evento que existe, en su mismo tick.
  for (const id of truth.ids(ENTITY)) {
    const base = truth.get(ENTITY, id);
    if (!base) continue;
    if (base.id !== id) problems.push(`${id}: la ficha dice ser ${base.id}`);
    const origin = log.get(base.originEventId);
    if (!origin) {
      problems.push(`${id} es huérfana: su origen ${base.originEventId} no está en el registro`);
    } else if (origin.tick !== base.createdAt) {
      problems.push(
        `${id}: creada en ${base.createdAt} por ${origin.id}, que pasó en ${origin.tick}`,
      );
    }
    if ((base.endedAt === undefined) !== (base.endEventId === undefined)) {
      problems.push(`${id}: endedAt y endEventId van juntos`);
    }
    if (base.endEventId !== undefined) {
      const end = log.get(base.endEventId);
      if (!end) problems.push(`${id}: su fin ${base.endEventId} no está en el registro`);
      else if (end.tick !== base.endedAt) {
        problems.push(`${id}: terminada en ${base.endedAt} por ${end.id}, que pasó en ${end.tick}`);
      }
      if (base.endedAt !== undefined && base.endedAt < base.createdAt) {
        problems.push(`${id}: termina (${base.endedAt}) antes de existir (${base.createdAt})`);
      }
    }
  }

  // Ningún componente sin entidad.
  for (const name of truth.tables()) {
    if (name === ENTITY.name) continue;
    for (const id of truth.ids({ name })) {
      if (!truth.has(ENTITY, id))
        problems.push(`${name}/${id}: componente de una entidad sin ficha`);
    }
  }

  // Ley 5: los eventos citan entidades que existen y no actúan antes de existir.
  const born = (id: EntityRef, e: Event, what: string) => {
    const base = truth.get(ENTITY, id);
    if (!base) problems.push(`${e.id}: ${what} ${id} no existe`);
    else if (base.createdAt > e.tick) {
      problems.push(`${e.id}: ${what} ${id} todavía no existía en ${e.tick}`);
    }
  };
  for (const e of log.all()) {
    for (const a of e.actors) born(a, e, "actor");
    for (const c of e.causes) {
      if (c.kind === "state") born(c.entity, e, "causa de estado");
      if (c.kind === "pressure") {
        born(c.pressure, e, "presión");
        const record = truth.get(PRESSURE, c.pressure);
        if (!record)
          problems.push(`${e.id}: cita a ${c.pressure}, que no tiene registro de presión`);
        if (c.weight === undefined || c.weight > 1) {
          problems.push(`${e.id}: la causa ${c.pressure} no trae el valor del momento (0..1)`);
        }
      }
    }
  }

  // Una presión nace del primer evento que la cita, y su registro cuenta bien.
  for (const id of truth.ids(PRESSURE)) {
    const record = truth.get(PRESSURE, id);
    const base = truth.get(ENTITY, id);
    if (!record || !base) continue;
    const cites = (e: Event) => e.causes.some((c) => c.kind === "pressure" && c.pressure === id);
    const origin = log.get(base.originEventId);
    if (origin && !cites(origin)) {
      problems.push(`${id}: nace de ${origin.id}, que no la cita`);
    }
    const citing = log.all().filter(cites);
    if (citing.length !== record.discharges) {
      problems.push(
        `${id}: dice ${record.discharges} descargas y el registro tiene ${citing.length}`,
      );
    }
    if (citing.at(-1)?.id !== record.lastDischarge) {
      problems.push(`${id}: su última descarga no es ${citing.at(-1)?.id}`);
    }
  }

  // Ley 2: conservación, y cada asiento por un evento real de su mismo tick.
  if (ledger) {
    problems.push(...ledger.audit());
    for (const j of ledger.journal()) {
      const e = log.get(j.eventId);
      if (!e) problems.push(`asiento ${j.seq}: su evento ${j.eventId} no está en el registro`);
      else if (e.tick !== j.tick) {
        problems.push(`asiento ${j.seq}: en ${j.tick}, pero ${e.id} pasó en ${e.tick}`);
      }
    }
  }

  return problems;
}
