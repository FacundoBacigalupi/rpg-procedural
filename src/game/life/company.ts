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
        spots.set(key, [...(spots.get(key) ?? []), id]);
      }
      const rels = new Map<AgentId, Relations>();
      const meet = (from: AgentId, to: AgentId, now: Tick) => {
        const base = rels.get(from) ??
          truth.get(RELATIONS, from) ?? { toward: {} as Relations["toward"] };
        const cur = relationship(rels.get(from) ?? truth.get(RELATIONS, from), to, now, {
          dims: o.dims,
          bonds: o.bonds,
          schemaStrength: () => 0,
        });
        const gain = contactGain(COMPANY_FAMILIARITY, cur.dims.familiarity);
        if (gain <= 0) return;
        const dims = { ...cur.dims, familiarity: Math.min(1, cur.dims.familiarity + gain) };
        rels.set(from, {
          ...(base as Relations),
          toward: { ...base.toward, [to]: { ...cur, dims, updated: now } },
        });
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
