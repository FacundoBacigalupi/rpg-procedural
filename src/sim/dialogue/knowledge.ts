// Lo que cada uno oyó contar (dialogue §6, information): hasta que exista el almacén de creencias,
// el oyente sabe de primera mano a su casa y a quien tiene al lado, y de lo demás solo lo que le
// dijeron. Lo dicho queda como dicho (con quién y cuándo), no como verdad: se puede dudar o
// revisar cuando llega algo mejor.

import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";

export interface HeardClaim {
  readonly about: AgentId;
  readonly claim: "dead" | "alive";
  readonly from: AgentId;
  readonly at: Tick;
}

export interface Heard {
  readonly claims: readonly HeardClaim[];
}

/** Lo que alguien oyó contar, en su entidad. */
export const HEARD = table<Heard>("dialogue.heard");

/** Cuántas cosas oídas se guardan (las más viejas se olvidan). */
export const KEPT_CLAIMS = 24;

/** Suma `claim`: una nueva sobre lo mismo reemplaza a la anterior. */
export function hear(before: Heard | undefined, claim: HeardClaim): Heard {
  const kept = (before?.claims ?? []).filter((c) => c.about !== claim.about);
  return { claims: [...kept, claim].slice(-KEPT_CLAIMS) };
}

/**
 * Una creencia propia que su dueño guarda como secreto (dialogue §7): marca la creencia (sobre
 * quién, qué atributo) con lo que le cuesta que salga, 0-1. El contenido sigue siendo la creencia.
 */
export interface Secret {
  readonly about: AgentId;
  readonly attr: "at" | "alive";
  readonly stakes: number;
  /** Desde cuándo lo guarda (los secretos que nacen de un hecho; el del seed no lo trae). */
  readonly since?: Tick;
  /** El evento que lo hizo secreto. */
  readonly cause?: EventId;
}

/** Días de mundo para que el costo de un secreto baje a la mitad si nada lo reaviva (sin calibrar). */
export const SECRET_HALF_LIFE_DAYS = 365;
/** Cuántos secretos guarda cada quien (se olvida el de menor costo). */
export const KEPT_SECRETS = 12;

const DAY_SECONDS = 86_400;

/** Lo que cuesta que salga hoy: el costo marcado, enfriado desde `since`. */
export function stakesAt(s: Secret, now: Tick): number {
  if (s.since === undefined) return s.stakes;
  const days = Math.max(0, now - s.since) / DAY_SECONDS;
  return Math.round(s.stakes * 0.5 ** (days / SECRET_HALF_LIFE_DAYS) * 1e6) / 1e6;
}

export interface SecretBirth {
  readonly about: AgentId;
  readonly attr: "at" | "alive";
  /** 0-1: cuánto daño hizo lo que se esconde (una muerte 1, un robo chico poco). */
  readonly harm: number;
  /** 0-1: cuánto lo condena su propia cultura y valores. */
  readonly moralWeight: number;
  /** 0-1: miedo a que se sepa. */
  readonly fearOfExposure: number;
  readonly at: Tick;
  readonly cause: EventId;
}

/** El costo inicial de un secreto nacido de un hecho: daño × condena × miedo a que se sepa. */
export function birthStakes(
  b: Pick<SecretBirth, "harm" | "moralWeight" | "fearOfExposure">,
): number {
  const c = (x: number) => Math.min(1, Math.max(0, x));
  return (
    Math.round(
      c(b.harm) * (0.4 + 0.6 * c(b.moralWeight)) * (0.4 + 0.6 * c(b.fearOfExposure)) * 1e6,
    ) / 1e6
  );
}

/**
 * Nace un secreto de algo que la persona hizo (dialogue §7): nace con el costo de `birthStakes`; si
 * ya guardaba uno sobre lo mismo se agrava (el mayor más un tercio del otro, con tope 1). Sin miedo
 * ni condena que lo sostengan no nace nada (no hay qué esconder).
 */
export function bornSecret(before: Secrets | undefined, b: SecretBirth): Secrets {
  const items = before?.items ?? [];
  const stakes = birthStakes(b);
  if (stakes <= 0) return before ?? { items };
  const old = items.find((s) => s.about === b.about && s.attr === b.attr);
  const merged = old
    ? Math.min(1, Math.max(stakesAt(old, b.at), stakes) + Math.min(stakesAt(old, b.at), stakes) / 3)
    : stakes;
  const next: Secret = {
    about: b.about,
    attr: b.attr,
    stakes: Math.round(merged * 1e6) / 1e6,
    since: b.at,
    cause: b.cause,
  };
  const rest = items.filter((s) => s !== old);
  const kept = [...rest, next]
    .sort((x, y) => stakesAt(y, b.at) - stakesAt(x, b.at))
    .slice(0, KEPT_SECRETS);
  return { items: kept };
}

export interface Secrets {
  readonly items: readonly Secret[];
}

/** Los secretos de cada persona, en su entidad. */
export const SECRETS = table<Secrets>("dialogue.secrets");

/** El secreto de `holder` sobre `about` (el de mayor costo si hay varios), si lo guarda. */
export function secretAbout(secrets: Secrets | undefined, about: AgentId): Secret | undefined {
  return (secrets?.items ?? [])
    .filter((s) => s.about === about)
    .reduce<Secret | undefined>(
      (a, s) => (a === undefined || s.stakes > a.stakes ? s : a),
      undefined,
    );
}
