// El lobo que bajó ataca (novel3-beasts-fight-attack, combat §15): una bestia con hambre que tiene
// en su hex a una sola persona al aire libre (nadie más afuera que la vea) la ataca para matarla,
// con chance por hora `BEAST_ATTACK_PER_DAY · hambre · horas/24`. La pelea es la de siempre
// (`strikeFight` con intención `kill`): el lobo con el perfil de su linaje y la persona
// defendiéndose para echarlo. Ataca una sola vez por bajada; después sigue hasta volver al monte.
// Con más gente afuera no se anima, y adentro no hay a quién ver.
// Quien la ve afuera en su hex y es miembro de una secta la anota para su secta
// (novel3-beasts-mission-seen, `BEAST_SEEN`): la primera vez con un evento `cultivation.beast_seen`;
// después solo cambia cuándo, quién y dónde. El atacado también la vio.

import type { AgentId, EntityRef, PlaceId, PlanetClock, Seed } from "../../core/index.ts";
import {
  BEAST,
  BEAST_SEEN,
  BEAST_SEEN_EVENT,
  BODY_STATE,
  type BodyPlanDef,
  draftEvent,
  ENTITY,
  type EventDraft,
  type LineageDef,
  LOCATION,
  type LocalMap,
  PERSON,
  type ProcessDef,
  type ReadonlyWorldTruth,
  SECT_MEMBER,
  SKILL_STATE,
  type SkillCatalog,
  type SpaceGraph,
  type StateChange,
  setComponent,
  skyLight,
  TRIBULATION,
  type Trait,
  YIELDED,
} from "../../sim/index.ts";
import { canFight, FIGHT_STATE, strikeFight } from "./fight.ts";

export const BEAST_ATTACK_PROCESS = "life.beast_attack";
/** La bestia se tira encima de alguien: causa de la pelea que sigue. */
export const BEAST_ATTACK_EVENT = "combat.beast_attack";
/** Chance por día de atacar con hambre plena a quien está solo (calibración abierta). */
export const BEAST_ATTACK_PER_DAY = 2;

export interface BeastAttackOptions {
  readonly lineages: readonly LineageDef[];
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly skills: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly spaces: SpaceGraph;
  readonly map: LocalMap;
  readonly clock: PlanetClock;
  readonly seed: Seed;
  /** Cada uno pelea con el cuerpo que le dejó el cultivo (`strikeFight.refined`). */
  readonly refined?: boolean;
}

/** Si quien está en `where` está al aire libre (sin espacio o en uno que no es adentro). */
function outdoors(spaces: SpaceGraph, where: { space?: string }): boolean {
  return (
    where.space === undefined || spaces.spaces.find((s) => s.key === where.space)?.indoor === false
  );
}

/** Las personas vivas al aire libre en `hex`, por id. */
export function outdoorsAt(truth: ReadonlyWorldTruth, spaces: SpaceGraph, hex: number): AgentId[] {
  const out: AgentId[] = [];
  for (const id of [...truth.ids(PERSON)].sort() as AgentId[]) {
    const at = truth.get(LOCATION, id);
    if (at?.hex !== hex || !outdoors(spaces, at)) continue;
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    if ((truth.get(BODY_STATE, id)?.death ?? null) !== null) continue;
    out.push(id);
  }
  return out;
}

export function beastAttackProcess(o: BeastAttackOptions): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  return {
    id: BEAST_ATTACK_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [
      BEAST.name,
      ENTITY.name,
      PERSON.name,
      LOCATION.name,
      BODY_STATE.name,
      SKILL_STATE.name,
      TRIBULATION.name,
      FIGHT_STATE.name,
      YIELDED.name,
      SECT_MEMBER.name,
      BEAST_SEEN.name,
    ],
    writes: [
      BEAST_SEEN.name,
      BEAST.name,
      BODY_STATE.name,
      SKILL_STATE.name,
      FIGHT_STATE.name,
      YIELDED.name,
    ],
    scopeGuard: (truth) => truth.ids(BEAST).length > 0,
    run(ctx) {
      const truth = ctx.truth;
      const hours = (ctx.window > 0 ? ctx.window : 3600) / 3600;
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const touched = new Set<AgentId>();
      for (const id of [...truth.ids(BEAST)].sort() as EntityRef[]) {
        const b = truth.get(BEAST, id);
        const me = id as unknown as AgentId;
        const at = truth.get(LOCATION, id);
        const body = truth.get(BODY_STATE, id);
        if (!b || !at || !body || ctx.now >= b.until) continue;
        if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const people = outdoorsAt(truth, o.spaces, at.hex);
        // Lo ve el primer miembro de una secta que está afuera ahí (por id).
        const witness = people.find((p) => truth.get(SECT_MEMBER, p) !== undefined);
        const org = witness === undefined ? undefined : truth.get(SECT_MEMBER, witness)?.org;
        if (witness !== undefined && org !== undefined && (body.death ?? null) === null) {
          const before = truth.get(BEAST_SEEN, id);
          if (before?.org === org) {
            changes.push(
              setComponent(BEAST_SEEN, id, { ...before, by: witness, at: ctx.now, hex: at.hex }),
            );
          } else {
            const seen = events.length;
            events.push({
              kind: BEAST_SEEN_EVENT,
              actors: [witness],
              place: { kind: "place", place: b.home as unknown as PlaceId },
              data: { beast: id, lineage: b.lineage, org, hex: at.hex },
              causes: [
                { kind: "state", entity: id, key: LOCATION.name },
                { kind: "state", entity: witness, key: LOCATION.name },
              ],
              emissions: null,
            });
            changes.push(
              setComponent(BEAST_SEEN, id, {
                org,
                by: witness,
                at: ctx.now,
                hex: at.hex,
                cause: draftEvent(seen),
              }),
            );
          }
        }
        if (b.attacked !== undefined || touched.has(me) || !canFight(truth, me)) continue;
        const prey = people[0];
        // Solo a quien está solo: con alguien más que lo vea, el lobo no se anima.
        if (people.length !== 1 || prey === undefined || touched.has(prey)) continue;
        if (!canFight(truth, prey) || truth.get(TRIBULATION, prey)) continue;
        if (truth.get(FIGHT_STATE, prey) || truth.get(YIELDED, prey)) continue;
        const chance = Math.min(1, BEAST_ATTACK_PER_DAY * (b.hunger ?? 0) * (hours / 24));
        if (!ctx.rng.fork("beast-attack", id).chance(chance)) continue;
        const place = { kind: "place" as const, place: b.home as unknown as PlaceId };
        const cause = events.length;
        events.push({
          kind: BEAST_ATTACK_EVENT,
          actors: [me, prey],
          place,
          data: { beast: id, lineage: b.lineage, target: prey, hunger: b.hunger ?? 0 },
          causes: [
            { kind: "state", entity: id, key: BEAST.name },
            { kind: "state", entity: prey, key: LOCATION.name },
          ],
          emissions: { sight: 0.8, sound: 0.6 },
        });
        const f = strikeFight({
          truth,
          me,
          myBody: body,
          target: prey,
          plans,
          skills: o.skills,
          traits: o.traits,
          intent: "kill",
          light: skyLight(o.map, o.clock, o.seed, ctx.now),
          ...(o.refined ? { refined: true } : {}),
          beasts: o.lineages,
          start: ctx.now,
          rng: ctx.rng.fork("beast-fight", id),
          day: o.clock.day,
          cause: draftEvent(cause),
          place,
        });
        changes.push(
          setComponent(BODY_STATE, id, f.myBody),
          setComponent(BEAST, id, { ...b, attacked: ctx.now }),
          ...f.changes,
        );
        events.push(f.event);
        touched.add(me);
        touched.add(prey);
      }
      return events.length === 0 && changes.length === 0 ? {} : { changes, events };
    },
  };
}
