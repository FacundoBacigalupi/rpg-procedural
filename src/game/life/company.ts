// Compañía (npc-psychology §6, Fase 2): compartir el lugar sostiene la familiaridad sin esperar a un
// evento grave. Cada hora, quienes están en el mismo espacio del sitio se conocen un poco más; la
// familiaridad decae sola (vida media en `relation-dims`), así que solo el trato la mantiene.

import type { AgentId, Tick } from "../../core/index.ts";
import {
  type BondDef,
  COMPANY_FAMILIARITY,
  contactGain,
  type DimensionDef,
  ENTITY,
  LOCATION,
  PERSON,
  type ProcessDef,
  RELATIONS,
  type Relations,
  type Relationship,
  relationship,
  type StateChange,
  setComponent,
} from "../../sim/index.ts";

export const COMPANY_PROCESS = "life.company";

export interface CompanyOptions {
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
}

export function companyProcess(o: CompanyOptions): ProcessDef {
  return {
    id: COMPANY_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, LOCATION.name, RELATIONS.name],
    writes: [RELATIONS.name],
    run(ctx) {
      const truth = ctx.truth;
      // Quién está dónde, de los vivos; solo cuentan los que comparten hex y espacio.
      const spots = new Map<string, AgentId[]>();
      for (const id of truth.ids(PERSON) as AgentId[]) {
        if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const at = truth.get(LOCATION, id);
        if (!at) continue;
        const key = `${at.hex}|${at.space ?? ""}`;
        const group = spots.get(key);
        if (group) group.push(id);
        else spots.set(key, [id]);
      }
      // Por quien siente: la relación base y una copia propia de `toward` que se muta (el resultado
      // es el mismo que rehacerla en cada encuentro, sin copiar todo el mapa cada vez).
      const rels = new Map<AgentId, Relations & { toward: Record<string, Relationship> }>();
      const ctxRel = { dims: o.dims, bonds: o.bonds, schemaStrength: () => 0 };
      const meet = (from: AgentId, to: AgentId, now: Tick) => {
        let work = rels.get(from);
        const cur = relationship(work ?? truth.get(RELATIONS, from), to, now, ctxRel);
        // No toca el mapa original; `work` solo se crea si hay ganancia.
        const gain = contactGain(COMPANY_FAMILIARITY, cur.dims.familiarity);
        if (gain <= 0) return;
        if (!work) {
          const base = truth.get(RELATIONS, from) ?? { toward: {} as Relations["toward"] };
          work = { ...(base as Relations), toward: { ...base.toward } };
          rels.set(from, work);
        }
        const dims = { ...cur.dims, familiarity: Math.min(1, cur.dims.familiarity + gain) };
        work.toward[to] = { ...cur, dims, updated: now };
      };
      for (const group of spots.values()) {
        if (group.length < 2) continue;
        for (const a of group) for (const b of group) if (a !== b) meet(a, b, ctx.now);
      }
      const changes: StateChange[] = [...rels].map(([id, r]) => setComponent(RELATIONS, id, r));
      return changes.length === 0 ? {} : { changes };
    },
  };
}
