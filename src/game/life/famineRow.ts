// La tabla de la hambruna y su lectura por quien la necesita en el trato. Módulo liviano (solo
// importa sim/): lo lee `act.ts`, que no puede importar `famine.ts` (arrastra routine.ts y cierra
// un ciclo). El escritor sigue siendo `life.famine`.

import {
  BUILDING,
  ENTITY,
  type FamineState,
  PERSON,
  type ReadonlyWorldTruth,
  table,
} from "../../sim/index.ts";

/** El estado de escasez de un asentamiento: vive en su entidad. */
export interface FamineRow {
  readonly state: FamineState;
  readonly value: number;
  readonly since: number;
  readonly pricePush: number;
  readonly migrationPull: number;
}
export const FAMINE = table<FamineRow>("economy.famine");

/** El asentamiento de un hogar: el de su casa en pie (undefined si no tiene). */
export function settlementOfHousehold(
  truth: ReadonlyWorldTruth,
  household: string,
): string | undefined {
  for (const id of truth.ids(BUILDING)) {
    const b = truth.get(BUILDING, id);
    if (b?.household === household && truth.get(ENTITY, id)?.endedAt === undefined) {
      return b.settlement;
    }
  }
  return undefined;
}

/**
 * El empuje de precio de la comida en el asentamiento de una persona (`FAMINE.pricePush`; 1 si no
 * hay filas, no hay escasez o la persona no tiene casa). Sin filas de `FAMINE` no cambia nada.
 */
export function pricePushOf(truth: ReadonlyWorldTruth, who: string): number {
  const home = truth.get(PERSON, who as never)?.household;
  if (home === undefined) return 1;
  const s = settlementOfHousehold(truth, home);
  if (s === undefined) return 1;
  const row = truth.get(FAMINE, s as never);
  return row && row.state !== "none" ? row.pricePush : 1;
}
