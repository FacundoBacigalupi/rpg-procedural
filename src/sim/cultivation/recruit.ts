// La competencia por discípulos (novel4-recruit-choice, organizations §2 y §10): cuando la segunda
// secta acepta en su prueba a un chico que la primera ya citó ese año, compite por él: a los de raíz
// leída alta les ofrece entrar como internos. El chico (su casa) elige entre las dos ofertas con lo
// que cree: el mejor rango primero, después la sede más cerca (las jornadas que cree), y si da igual
// se queda con la que ya lo citó. La que lo pierde guarda la ofensa a la otra.
//
// Puro: sin IO.

import type { EventId } from "../../core/index.ts";
import type { OrgTie } from "../org/index.ts";
import type { MemberRank } from "./member.ts";
import type { TrialReading } from "./trial.ts";

export const SECT_POACHED_EVENT = "org.sect_poached";

/** Desde qué calidad leída la segunda ofrece entrar como interno a quien ya citó la otra (sin calibrar). */
export const RECRUIT_INNER_QUALITY = 0.6;
/** Lo que sube el rencor de la secta a la que le quitaron un citado (sin calibrar). */
export const POACH_RESENTMENT = 0.04;

/** El rango que ofrece la secta: interno si compite por él y la piedra lo leyó alto. */
export function offeredRank(reading: TrialReading, contested: boolean): MemberRank {
  return contested && reading.quality >= RECRUIT_INNER_QUALITY ? "inner" : "outer";
}

const RANK_VALUE: Readonly<Record<MemberRank, number>> = {
  outer: 0,
  inner: 1,
  core: 2,
  elder: 3,
  master: 4,
};

/** Una oferta como la ve quien elige: el rango y las jornadas que cree hasta la sede. */
export interface SectOffer {
  readonly rank: MemberRank;
  readonly days: number;
}

/** Qué hace el citado con la segunda oferta: se queda con la primera o se cambia. */
export function chooseOffer(stay: SectOffer, offer: SectOffer): "stay" | "switch" {
  const rank = RANK_VALUE[offer.rank] - RANK_VALUE[stay.rank];
  if (rank !== 0) return rank > 0 ? "switch" : "stay";
  return offer.days < stay.days ? "switch" : "stay";
}

/** La ofensa de quedarse sin el citado: en las ofensas y la historia, con algo de rencor. */
export function afterPoached(tie: OrgTie, event: EventId): OrgTie {
  if (tie.grievances.includes(event)) return tie;
  const resentment = Math.min(1, tie.sentiment.resentment + POACH_RESENTMENT);
  return {
    ...tie,
    sentiment: { ...tie.sentiment, resentment: Math.round(resentment * 1000) / 1000 },
    grievances: [...tie.grievances, event],
    history: [...tie.history, event],
  };
}
