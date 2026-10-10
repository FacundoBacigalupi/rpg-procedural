// El apodo con lugar («el Carnicero de Valle Alto»), information §5 (reputación). Sale de la fama
// que el personaje ya nota (`reputationIn`, solo lectura): el epíteto del hecho que más gente
// cuenta y el lugar donde se lo cuentan. Es opt-in en la vista (`PlayerViewOptions.nickname`): el
// narrador solo lo cita si el personaje ya se enteró (fama que se nota y mal creída).

import type { AgentId } from "../../core/index.ts";
import {
  type DeedKind,
  KNOWN_DEEDS,
  LOCATION,
  PERSON,
  PLACE,
  PLACE_NAME,
  RUMORS,
  reputationIn,
} from "../../sim/index.ts";
import type { LifeWorld } from "./world.ts";

/** Desde qué fracción de la aldea la fama se nota. */
export const REPUTATION_NOTICED = 0.15;

/** Desde qué mal-creído (standing) el epíteto de violencia sube de «Matón» a «Carnicero». */
export const BUTCHER_STANDING = -0.7;

export interface Nickname {
  /** El epíteto solo («Carnicero»). */
  readonly epithet: string;
  /** El lugar propio al que se le agrega, si hay. */
  readonly place?: string;
  /** El apodo entero, como se dice («el Carnicero de Valle Alto»). */
  readonly text: string;
}

const EPITHET: Readonly<Record<DeedKind, string>> = {
  default: "Tramposo",
  theft: "Ladrón",
  assault: "Matón",
};

/** Puro: el apodo desde el hecho dominante y cuánto lo mal creen (-1..0), con lugar si hay. */
export function nicknameFor(kind: DeedKind, standing: number, place?: string): Nickname {
  const epithet = kind === "assault" && standing <= BUTCHER_STANDING ? "Carnicero" : EPITHET[kind];
  return {
    epithet,
    ...(place === undefined ? {} : { place }),
    text: place === undefined ? `el ${epithet}` : `el ${epithet} de ${place}`,
  };
}

/**
 * El apodo del personaje, o `null` si todavía no se nota su fama o no lo mal creen. Lee solo
 * `KNOWN_DEEDS`/`RUMORS`; sin RNG ni estado nuevo.
 */
export function playerNickname(w: LifeWorld): Nickname | null {
  const rep = reputationIn(
    w.truth.ids(PERSON) as readonly AgentId[],
    w.player,
    (id) => w.truth.get(KNOWN_DEEDS, id),
    (id) => w.truth.get(RUMORS, id),
  );
  if (rep.dominant === null || rep.fame < REPUTATION_NOTICED || rep.standing >= 0) return null;
  const at = w.truth.get(LOCATION, w.player);
  let place: string | undefined;
  for (const id of w.truth.ids(PLACE)) {
    if (!at || !w.truth.get(PLACE, id)?.hexes.includes(at.hex)) continue;
    const form = w.truth.get(PLACE_NAME, id)?.form;
    if (form !== undefined) {
      place = form;
      break;
    }
  }
  return nicknameFor(rep.dominant, rep.standing, place);
}
