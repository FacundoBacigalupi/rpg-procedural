// Lanzar la técnica de ataque contra alguien (novel3-technique-act, combat §9): «uso la técnica
// contra X», el modo `art` de `strike`. Quien la sabe (`ART_KNOWN`, de su escuela) la lanza con el
// qi del recipiente; no hay pelea cuerpo a cuerpo: sale de la mano, llega o no, y si llega hiere.
// Lo gastado y el contragolpe no se escriben acá: el evento `combat.art` los trae y `life.meditate`
// (dueño del recipiente y de la reserva) saca el qi del cuerpo y lo devuelve a la celda.
import type { AgentId, EventId, PlaceRef, Rng, Tick } from "../../core/index.ts";
import {
  ART_KNOWN,
  type ArtGist,
  ASLEEP,
  type AttackArt,
  BODY_STATE,
  type BodyPlanDef,
  CULTIVATION_STATE,
  castArt,
  type EventDraft,
  injure,
  type ReadonlyWorldTruth,
  SECT_SCHOOL,
  SKILL_STATE,
  type SkillCatalog,
  type StateChange,
  setComponent,
  verbSkill,
} from "../../sim/index.ts";

export const ART_EVENT = "combat.art";
/** Los metros hasta el blanco en el mismo lugar (sin posiciones finas todavía). */
export const ART_DISTANCE = 4;
/** Cuánto se le corre el blanco despierto por cada punto de su habilidad de pelea (sin calibrar). */
export const ART_EVADE = 0.25;

export interface ArtCastInput {
  readonly truth: ReadonlyWorldTruth;
  readonly me: AgentId;
  readonly target: AgentId;
  /** El plan del cuerpo del blanco. */
  readonly plan: BodyPlanDef;
  readonly skills: SkillCatalog;
  readonly rng: Rng;
  readonly cause: EventId;
  readonly at: Tick;
  readonly place: PlaceRef;
}

export interface ArtCast {
  readonly gist: ArtGist;
  readonly changes: readonly StateChange[];
  readonly event?: EventDraft;
}

/** La técnica que sabe alguien, con los números de su escuela. */
export function knownArt(
  truth: ReadonlyWorldTruth,
  who: AgentId,
): { readonly art: AttackArt; readonly name: string; readonly org: string } | undefined {
  const known = truth.get(ART_KNOWN, who);
  if (!known) return undefined;
  const school = truth.get(SECT_SCHOOL, known.org)?.art;
  if (!school || school.name !== known.name) return undefined;
  return {
    art: {
      id: known.org,
      shape: "projectile",
      cost: school.cost,
      range: school.range,
      power: school.power,
      difficulty: school.difficulty,
      wound: school.wound,
    },
    name: school.name,
    org: known.org,
  };
}

/** Lanza la técnica que sabe `me` contra `target`: la herida, el evento y lo que sabe de cómo salió. */
export function castAtTarget(i: ArtCastInput): ArtCast {
  const known = knownArt(i.truth, i.me);
  if (!known) return { gist: { outcome: "unknown", backlash: false }, changes: [] };
  const mine = i.truth.get(CULTIVATION_STATE, i.me);
  const body = i.truth.get(BODY_STATE, i.target);
  // Dormido o caído no se corre; despierto, lo que sabe de pelear le abre el paso.
  const still =
    i.truth.get(ASLEEP, i.target) !== undefined ||
    !body ||
    body.death !== null ||
    body.consciousness === "unconscious";
  const control = Math.max(
    0,
    verbSkill(i.skills, i.truth.get(SKILL_STATE, i.me), "strike") *
      (1 - (mine?.meridianDamage ?? 0)),
  );
  const cast = castArt({
    art: known.art,
    qi: mine?.qi ?? 0,
    control,
    distance: ART_DISTANCE,
    evade: still
      ? 0
      : Math.min(1, ART_EVADE * verbSkill(i.skills, i.truth.get(SKILL_STATE, i.target), "strike")),
    rng: i.rng,
    cause: i.cause,
    at: i.at,
  });
  const gist: ArtGist = { name: known.name, outcome: cast.outcome, backlash: cast.backlash > 0 };
  // Sin el qi no la empieza: no sale nada, nadie ve nada.
  if (cast.outcome === "no_qi") return { gist, changes: [] };
  const changes: StateChange[] = [];
  const hits: { to: AgentId; zone: string; severity: number }[] = [];
  if (cast.blow && body && body.death === null) {
    const hurt = injure(i.plan, body, cast.blow, i.rng.fork("art-hit"));
    changes.push(setComponent(BODY_STATE, i.target, hurt.body));
    hits.push({ to: i.target, zone: hurt.wound.zone, severity: hurt.wound.severity });
  }
  return {
    gist,
    changes,
    event: {
      kind: ART_EVENT,
      actors: [i.me, i.target],
      place: i.place,
      data: {
        art: known.name,
        org: known.org,
        outcome: cast.outcome,
        spent: cast.spent,
        backlash: cast.backlash,
        hits,
      },
      // El qi que sale de la mano se ve y suena: no es un golpe callado.
      emissions: { sight: 0.8, sound: 0.6 },
      causes: [{ kind: "event", event: i.cause }],
    },
  };
}
