import type { Event } from "../../core/index.ts";
import type { Location } from "../../sim/index.ts";

/** Marca persistida solo por el opt-in del productor: no vuelve perceptible el legado. */
export function perceptibleBandRaid(e: Event): boolean {
  return (
    e.kind === "band.raided" &&
    (e.data as { perceptibleRaid?: boolean } | null)?.perceptibleRaid === true &&
    bandRaidLocation(e) !== undefined
  );
}

/** Sitio fijado al asaltar: una marcha posterior del cabecilla no mueve el estímulo. */
export function bandRaidLocation(e: Event): Location | undefined {
  const at = (e.data as { raidAt?: Location } | null)?.raidAt;
  return at &&
    Number.isSafeInteger(at.hex) &&
    (at.space === undefined || typeof at.space === "string")
    ? at
    : undefined;
}
