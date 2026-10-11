// Versiones de un guardado y qué pasa al abrirlo con otro motor (tooling §4). Puro: sin IO.
//
// Motor nuevo con una vida en curso: la vida sigue con el motor nuevo desde el estado guardado, y el
// replay desde el seed deja de valer más allá de ese punto; se registra un límite de replay (tick y
// versiones) en `meta`. El formato y el contenido distintos no se cruzan acá: el formato pide una
// migración de esquema y el contenido se compara por hash.

export interface SaveVersions {
  readonly engine: string;
  readonly content: string;
  readonly format: number;
}

/** El punto donde el replay desde el seed deja de valer porque la vida cruzó de motor. */
export interface ReplayLimit {
  readonly tick: number;
  readonly from: SaveVersions;
  readonly to: SaveVersions;
}

export type VersionCheck =
  | { readonly kind: "same" }
  | { readonly kind: "upgrade"; readonly versions: SaveVersions; readonly limit: ReplayLimit }
  | { readonly kind: "incompatible"; readonly reason: string };

/** El número de un motor `life-N`, o `undefined` si no tiene esa forma. */
export function engineNumber(engine: string): number | undefined {
  const m = /^life-(\d+)$/.exec(engine);
  return m ? Number(m[1]) : undefined;
}

/**
 * Compara las versiones guardadas con las del motor que abre el guardado. Solo se cruza hacia un
 * motor más nuevo (`life-N` a `life-M` con M > N) con el mismo formato y contenido; en ese caso
 * devuelve las versiones nuevas y el límite de replay en `tick`. Lo demás es incompatible.
 */
export function upgradeVersions(
  saved: SaveVersions,
  current: SaveVersions,
  tick: number,
): VersionCheck {
  if (
    saved.engine === current.engine &&
    saved.content === current.content &&
    saved.format === current.format
  )
    return { kind: "same" };
  if (saved.format !== current.format || saved.content !== current.content) {
    return {
      kind: "incompatible",
      reason: `formato o contenido distintos: guardado ${JSON.stringify(saved)}, motor ${JSON.stringify(current)}`,
    };
  }
  const from = engineNumber(saved.engine);
  const to = engineNumber(current.engine);
  if (from === undefined || to === undefined || to <= from) {
    return {
      kind: "incompatible",
      reason: `el guardado es del motor ${saved.engine} y este es ${current.engine}: solo se pasa a uno más nuevo`,
    };
  }
  return { kind: "upgrade", versions: current, limit: { tick, from: saved, to: current } };
}
