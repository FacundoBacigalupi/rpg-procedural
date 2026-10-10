// La decisión de los NPC (npc-psychology §7, Fase 3): cada día (cada hora en escena), cada uno puntúa sus candidatas
// —las del catálogo desde lo que cree (`verbCandidates`) y las sociales desde sus relaciones—
// con las necesidades de su cuerpo, sus valores con el sesgo de su cultura y la etapa de su vida,
// y elige con softmax (`decideByUtility`, `rng.fork("decision", npc, tick)`). Lo elegido queda en
// `life.decision` y, si cambió el verbo o el objetivo, como evento `npc.decided` con su causa.
// El personaje del jugador no pasa por acá. Todavía no mueve el cuerpo: la rutina (`life.routine`)
// sigue siendo quien actúa; que la decisión se vuelva plan es el ítem siguiente.

import {
  type AgentId,
  type EntityRef,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type PlanetClock,
  type Tick,
} from "../../core/index.ts";
import {
  ACCLIMATIZATION,
  type ActionCatalog,
  AMPUTATIONS,
  applyAcute,
  BELIEFS,
  type BeliefView,
  BODY_STATE,
  type BodyPlanDef,
  type BondDef,
  beliefConfidenceAt,
  believed,
  type Candidate,
  capabilitiesOf,
  closeness,
  coreGoals,
  DEFICIENCY_EFFECTS,
  type DimensionDef,
  decideByUtility,
  drivesFor,
  ENTITY,
  FROSTBITE,
  type Goal,
  type GoodDef,
  GROWTH_SEQUELAE,
  goalChanges,
  goalDrives,
  goodUnit,
  HABITS,
  type HabitDef,
  INNATE,
  kinWeight,
  LOCATION,
  layerDrives,
  longGoals,
  MEMORIES,
  MENTAL,
  MIND,
  mediumGoals,
  mergeCandidates,
  modifyCandidates,
  moodFrom,
  otherBeliefFrom,
  PERSON,
  PLACE,
  PRICE_BELIEFS,
  type ProcessDef,
  pantryTexts,
  RELATIONS,
  RELIGIOUS_IDENTITY,
  type ReadonlyWorldTruth,
  reconcileGoals,
  relationship,
  revengeGoals,
  type SchemaDef,
  SELF_IMAGES,
  SKILL_STATE,
  type SkillCatalog,
  STAKES_RISK,
  type StageDef,
  sanctionFor,
  sanctionWeight,
  seedSelfImage,
  setComponent,
  shortGoals,
  socialCandidates,
  stageAt,
  standardize,
  THERMAL,
  TREATED_WATER,
  type Trait,
  table,
  temperOf,
  type ValueDef,
  valueBias,
  verbCandidates,
  verbHabits,
  villageCulture,
  villageReligion,
} from "../../sim/index.ts";
import { applyAltitude } from "./altitude.ts";
import { cueLocalOf, objectsSeen } from "./cue-local.ts";
import { applyDeficiency } from "./deficiencyCaps.ts";
import {
  CRAFTSMAN_VERBS,
  MOLD_RUMORS,
  type MoldHintOptions,
  moldBuyGoods,
  moldCraftsmen,
  moldHintMood,
} from "./moldgossip.ts";
import {
  acuteOf,
  type BorrowCravingOptions,
  type BuyCravingOptions,
  type ConsumableDef,
  cravingApproachMoves,
  cravingBorrowAsks,
  cravingBorrowMood,
  cravingBuyGoods,
  cravingBuyMood,
  cravingGatherMood,
  cueContextOf,
  cueCravingOf,
  type GatherCravingOptions,
} from "./substances.ts";
import { applyCoreTemp, applyFrostbite } from "./thermal.ts";

export const DECIDE_PROCESS = "life.decide";
export const DECIDED_EVENT = "npc.decided";
export const GOAL_EVENT = "npc.goal";

/** Lo último que eligió un NPC. */
export interface Decision {
  readonly at: Tick;
  readonly id: string;
  readonly verb: string;
  readonly target?: string;
  readonly utility: number;
  readonly options: number;
}

export const NPC_DECISION = table<Decision>("life.decision");

/** Los objetivos vigentes de un NPC (núcleo y venganza, `sim/mind/goals.ts`). */
export interface NpcGoals {
  readonly items: readonly Goal[];
}

export const NPC_GOALS = table<NpcGoals>("life.goals");

/** A cuántas personas considera como mucho (las que más conoce). */
export const MAX_KNOWN = 12;
/** Cuánto afecto/parentesco (`closeness`) hace que alguien le importe (sin calibrar). */
export const CARES_MIN = 0.3;

export interface DecideOptions {
  readonly clock: PlanetClock;
  readonly catalog: ActionCatalog;
  readonly skills: SkillCatalog;
  readonly traits: readonly Trait[];
  readonly bodyPlans: readonly BodyPlanDef[];
  readonly values: readonly ValueDef[];
  readonly schemas: readonly SchemaDef[];
  readonly stages: readonly StageDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  /** Bienes del mundo: con ellos los verbos con `what` nombran lo que hay en la despensa. */
  readonly goods?: readonly GoodDef[];
  /** Definiciones de hábitos: los asentados empujan su verbo en la utilidad. */
  readonly habits?: readonly HabitDef[];
  readonly player: AgentId;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
  /** Opt-in: la altura baja la resistencia creída (`applyAltitude`); apagado, no cambia. */
  readonly altitudeOf?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /** Opt-in: la congelación y las amputaciones bajan manos y pies (`applyFrostbite`); apagado, no cambia. */
  readonly frostbite?: boolean;
  /** Opt-in: el núcleo frío o caliente baja la destreza o deja inconsciente (`applyCoreTemp`); apagado, no cambia. */
  readonly coreEffects?: boolean;
  /** Opt-in: carencias (`vigor`, `oxygen`, `cognition`) y secuela cognitiva bajan las capacidades (`applyDeficiency`); apagado, no cambia. */
  readonly nutritionCaps?: boolean;
  /**
   * Opt-in: sustancias de consumo que tiene en la despensa que cree tener: el verbo `consume`
   * las nombra y el ansia (`serves: craving`) lo empuja. Apagado, no hay candidata nueva.
   */
  readonly consumables?: readonly ConsumableDef[];
  /**
   * Opt-in (exige `consumables`): con ansia alta y sin la sustancia en la despensa, `trade` de
   * compra de ese bien entra como candidata (cadena conseguir → tomar) con ánimo que crece con el
   * ansia y cae con el precio creído (`moldHints.believedPerKg`, si hay). Apagado, no cambia.
   */
  readonly buyCraving?: BuyCravingOptions;
  /**
   * Opt-in (exige `consumables`): con ansia alta, sin la sustancia en la despensa y sin con quién
   * comprarla (ninguna candidata de `trade` para ese bien), `gather` de la planta que el catálogo
   * rinde entra como candidata con ánimo que crece con el ansia. Apagado, no cambia.
   */
  readonly gatherCraving?: GatherCravingOptions;
  /**
   * Opt-in (exige `consumables` y `moldHints`): con ansia alta, sin la sustancia en la despensa y
   * sin con quién comprarla ni planta que recolectar, `speak` pidiéndola a un conocido del que oyó
   * (rumor `attr` `has`, creencia y no verdad) que la tiene entra como candidata, con ánimo que
   * crece con el ansia y con la confianza en el rumor. Apagado, no cambia.
   */
  readonly borrowCraving?: BorrowCravingOptions;
  /** Opt-in: las señales aprendidas (lugar, persona, hora) suman ansia sin abstinencia; apagado, no cambia. */
  readonly cravingCues?: boolean;
  /**
   * Opt-in (con `cravingCues`): las señales leen a quién CREE presente (sus creencias) y la hora del
   * huso del lugar (`lonDeg`); apagado, el entorno es el de siempre (mismo hex, hora global).
   */
  readonly cueLocal?: { readonly lonDeg: number };
  /**
   * Opt-in (con `cravingCues`, `cueLocal` y `consumables`): ver en su despensa el objeto que
   * gatilla el ansia (señal `CueKind` "object") sube el ansia y con ella la utilidad de tomarlo y
   * de conseguirlo (la compra sigue cayendo con el precio creído); apagado, no cambia.
   */
  readonly objectCues?: boolean;
  /**
   * Opt-in: lo que cree de oídas (`MOLD_RUMORS`) empuja el ánimo de ir hacia donde cree que hay algo
   * y de comerciar un bien del que oyó el precio (`moldHintMood`, `moldUsefulness`); apagado, no lee la tabla ni cambia.
   */
  readonly moldHints?: MoldHintOptions;
  /**
   * Opt-in: con la sed por encima de `minThirst` y sin agua tratada vigente, el verbo `boil` entra
   * como candidata (empuja `thirst` con `weight`); `life.routine` con `boil` la cumple. Apagado, no
   * hay candidata nueva ni se lee `TREATED_WATER`.
   */
  readonly boilThirst?: { readonly minThirst: number; readonly weight: number };
}

const r = (x: number) => Math.round(x * 1e6) / 1e6;

export function decideProcess(o: DecideOptions): ProcessDef {
  const plans = new Map(o.bodyPlans.map((p) => [p.id, p]));
  return {
    id: DECIDE_PROCESS,
    system: "life",
    scope: "agent",
    cadence: { local: "day", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [
      BODY_STATE.name,
      PERSON.name,
      ENTITY.name,
      INNATE.name,
      MIND.name,
      RELATIONS.name,
      BELIEFS.name,
      MEMORIES.name,
      HABITS.name,
      MENTAL.name,
      LOCATION.name,
      ACCLIMATIZATION.name,
      DEFICIENCY_EFFECTS.name,
      GROWTH_SEQUELAE.name,
      FROSTBITE.name,
      THERMAL.name,
      AMPUTATIONS.name,
      PLACE.name,
      SELF_IMAGES.name,
      SKILL_STATE.name,
      NPC_DECISION.name,
      NPC_GOALS.name,
      "culture.community",
      ...(o.moldHints ? [MOLD_RUMORS.name, PRICE_BELIEFS.name] : []),
      ...(o.boilThirst ? [TREATED_WATER.name] : []),
    ],
    writes: [NPC_DECISION.name, NPC_GOALS.name],
    run(ctx) {
      const me = ctx.scope as AgentId;
      const truth = ctx.truth;
      if (me === o.player) return {};
      const person = truth.get(PERSON, me);
      const body = truth.get(BODY_STATE, me);
      const mind = truth.get(MIND, me);
      const innate = truth.get(INNATE, me);
      if (!person || !body || !mind || !innate) return {};
      if (truth.get(ENTITY, me)?.endedAt !== undefined) return {};
      if (body.death || body.consciousness === "unconscious") return {};
      const plan = plans.get(body.plan);
      if (!plan) throw new RangeError(`plan corporal desconocido: ${body.plan}`);

      const now = ctx.now;
      const age = (now - person.born) / o.clock.year;
      const culture = villageCulture(truth);

      // A quién conoce: relaciones, la casa y lo que cree que vive, los que más conoce primero.
      const rels = truth.get(RELATIONS, me);
      const beliefs = truth.get(BELIEFS, me);
      const relCtx = {
        dims: o.dims,
        bonds: o.bonds,
        schemaStrength: (s: string) => mind.schemas[s]?.strength ?? 0,
      };
      const known = new Set<AgentId>(Object.keys(rels?.toward ?? {}) as AgentId[]);
      for (const b of beliefs?.items ?? []) {
        if (b.prop.attr === "alive" && b.value === true) known.add(b.prop.subject);
      }
      for (const id of truth.ids(ENTITY)) {
        if (!id.startsWith("agent:") || id === me) continue;
        if (truth.get(PERSON, id as AgentId)?.household === person.household) {
          known.add(id as AgentId);
        }
      }
      known.delete(me);
      const people = [...known]
        .filter((id) => {
          if (truth.get(ENTITY, id)?.endedAt === undefined) return true;
          // Murió y no lo sabe: sigue contando como vivo para él.
          const alive = believed(beliefs, id, "alive");
          return alive?.value === true && beliefConfidenceAt(alive, now) > 0.2;
        })
        .map((id) => ({ id, rel: relationship(rels, id, now, relCtx) }))
        .sort((a, b) => b.rel.dims.familiarity - a.rel.dims.familiarity || (a.id < b.id ? -1 : 1))
        .slice(0, MAX_KNOWN);
      const housemates = new Set(
        people
          .filter((p) => truth.get(PERSON, p.id)?.household === person.household)
          .map((p) => p.id),
      );

      const here = truth.get(LOCATION, me)?.hex ?? 0;

      // El ánimo sale de su memoria (e3): el miedo de lo que le dolió hace poco y las horas desde
      // que estuvo con alguien que le importa (si hay alguien así acá ahora, no está solo).
      const memories = truth.get(MEMORIES, me);
      const cared = new Set(
        people.filter((p) => closeness(p.rel.dims, p.rel.bonds) >= CARES_MIN).map((p) => p.id),
      );
      const acute = acuteOf(truth, me);
      // Opt-in `objectCues`: los consumibles que ve en su despensa gatillan la señal por objeto.
      const seenObjects = o.objectCues
        ? objectsSeen(
            (o.consumables ?? []).map((c) => c.good),
            (good) => {
              const g = (o.goods ?? []).find((x) => x.id === good);
              const held = ctx.ledger?.holdings(
                holderAccount(person.household as unknown as HolderRef),
              );
              return g ? (held?.find((h) => h.unit === goodUnit(g))?.amount ?? 0) : 0;
            },
          )
        : [];
      const mood = {
        ...moodFrom({
          memories,
          now,
          cares: (who) => cared.has(who),
          withCompany: [...cared].some((id) => truth.get(LOCATION, id)?.hex === here),
        }),
        craving: o.cravingCues
          ? Math.max(
              acute.craving,
              cueCravingOf(
                truth,
                me,
                cueContextOf(
                  truth,
                  me,
                  now,
                  o.clock,
                  o.cueLocal
                    ? {
                        ...cueLocalOf(truth, me, now, o.clock, o.cueLocal.lonDeg),
                        ...(seenObjects.length > 0 ? { objects: seenObjects } : {}),
                      }
                    : undefined,
                ),
                now,
                o.clock,
              ),
            )
          : acute.craving,
        numbing: acute.numbing,
      };
      const drives = drivesFor({
        plan,
        body,
        mood,
        valueDefs: o.values,
        schemaDefs: o.schemas,
        mind,
        innate,
        bias: valueBias(culture?.prevalence["values.bias"]?.params ?? {}),
        stage: stageAt(o.stages, age),
      });
      const temper = temperOf(innate, mood);

      // Los objetivos: núcleo desde sus valores y venganza desde el resentimiento con memoria que lo
      // explique. Se reconcilian con los vigentes; los que nacen o terminan quedan como `npc.goal`.
      const prevGoals = truth.get(NPC_GOALS, me)?.items ?? [];
      const goals = reconcileGoals(prevGoals, [
        ...coreGoals(drives.values as never, o.schemas, mind, now),
        ...revengeGoals(
          people.map((p) => ({ who: p.id, resentment: p.rel.dims.resentment ?? 0 })),
          {
            memories,
            now,
            warmth: innate["warmth"] ?? 0.5,
            control: innate["control"] ?? 0.5,
            strengthIsWorth: mind.schemas["strength_is_worth"]?.strength ?? 0,
          },
        ),
      ]);
      // Capas derivadas (largo, mediano, corto): se recalculan cada vez, no se guardan; solo
      // empujan un poco los valores (desempatan).
      const layered = [
        ...longGoals(goals, mind, now),
        ...mediumGoals(
          people.map((p) => ({
            who: p.id,
            resentment: p.rel.dims.resentment ?? 0,
            closeness: closeness(p.rel.dims, p.rel.bonds),
            kin: kinWeight(p.rel.bonds) > 0,
            debt: 0,
          })),
          {
            memories,
            now,
            warmth: innate["warmth"] ?? 0.5,
            control: innate["control"] ?? 0.5,
            strengthIsWorth: mind.schemas["strength_is_worth"]?.strength ?? 0,
          },
          goals,
        ),
        ...shortGoals(drives.needs, goals, mind.originEventId, now),
      ];
      const { born, ended } = goalChanges(prevGoals, goals);
      const goalEvents = [
        ...born.map((g) => ({ g, what: "born" as const })),
        ...ended.map((g) => ({ g, what: "ended" as const })),
      ].map(({ g, what }) => ({
        kind: GOAL_EVENT,
        actors: [me],
        place: o.placeOf(truth, me),
        data: {
          goal: g.id,
          layer: g.layer,
          what,
          weight: g.weight,
          ...(g.value === undefined ? {} : { value: g.value }),
          ...(g.target === undefined ? {} : { target: g.target }),
        },
        emissions: {},
        causes: [
          { kind: "event", event: g.originEventId } as const,
          ...(what === "ended" ? [{ kind: "state", entity: me, key: "goals" } as const] : []),
        ],
      }));
      const goalChange =
        born.length + ended.length > 0 || prevGoals.length !== goals.length
          ? [setComponent(NPC_GOALS, me, { items: goals })]
          : [];
      const acuteCaps = applyAcute(capabilitiesOf(plan, body), acute);
      const altCaps = o.altitudeOf ? applyAltitude(acuteCaps, truth, me, o.altitudeOf) : acuteCaps;
      const frostCaps = o.frostbite ? applyFrostbite(altCaps, truth, me) : altCaps;
      const coreCaps = o.coreEffects ? applyCoreTemp(frostCaps, truth, me) : frostCaps;
      const caps = o.nutritionCaps ? applyDeficiency(coreCaps, truth, me) : coreCaps;
      const images = truth.get(SELF_IMAGES, me);
      const skills = truth.get(SKILL_STATE, me);
      const view: BeliefView = {
        hex: here,
        risk: {
          id: me as unknown as EntityRef,
          z: standardize(innate, o.traits, person.sex),
          scene: { light: 1, terrain: 0.1, placeKinds: [] },
        },
        capability: (cap) => Math.round(caps[cap] * 10) / 10,
        skill: (id) => {
          const def = o.skills.skill(id);
          const state = skills?.[id];
          const image =
            images?.[id] ?? (def && state ? seedSelfImage(def, state, {}, now) : undefined);
          return image?.estimate;
        },
        hexOf: (ref) => {
          const id = ref as unknown as AgentId;
          const b = believed(beliefs, id, "at");
          if (b && typeof b.value === "object") return b.value.hex;
          // Sin creencia, solo los de su casa se dan por ubicados donde la verdad los pone.
          if (housemates.has(id)) return truth.get(LOCATION, id)?.hex ?? null;
          return people.some((p) => p.id === id) ? null : undefined;
        },
        hexesOf: (ref) => truth.get(PLACE, ref)?.hexes,
        placeKindsAt: (hex) =>
          truth.ids(PLACE).flatMap((id) => {
            const p = truth.get(PLACE, id);
            return p?.hexes.includes(hex) ? [p.kind] : [];
          }),
        holds: (holder) => (holder === "self" ? true : undefined),
        nameOf: () => "alguien",
      };

      // La despensa que cree tener: la de su casa, que conoce (no hay foto de NPC todavía).
      const larder = ctx.ledger?.holdings(holderAccount(person.household as unknown as HolderRef));
      const pantry = pantryTexts(
        (o.goods ?? []).flatMap((g) => {
          const unit = goodUnit(g);
          const amount = larder?.find((h) => h.unit === unit)?.amount ?? 0;
          return g.form === "good" ? [{ name: g.name, amount }] : [];
        }),
      );
      const stash = (o.consumables ?? []).flatMap((c) => {
        const g = (o.goods ?? []).find((x) => x.id === c.good);
        const have = g ? (larder?.find((h) => h.unit === goodUnit(g))?.amount ?? 0) : 0;
        return g && have >= 1 ? [g.name] : [];
      });
      const hintBook = o.moldHints ? truth.get(MOLD_RUMORS, me) : undefined;
      const hintPriced = {
        beliefs: o.moldHints ? truth.get(PRICE_BELIEFS, me) : undefined,
        day: Math.floor(now / o.clock.day),
      };
      // Lo oído barato que no tiene en la despensa: candidata de compra (opt-in `buyCandidates`).
      const pantryTrade = new Set(pantry["trade"] ?? []);
      const buyOnly =
        o.moldHints && hintBook
          ? moldBuyGoods(hintBook, o.moldHints, hintPriced).filter((n) => !pantryTrade.has(n))
          : [];
      // Ansia sin la sustancia a mano: comprarla (opt-in `buyCraving`); la usa `consume` después.
      const craveBuy = o.buyCraving
        ? cravingBuyGoods(
            mood.craving,
            (o.consumables ?? []).flatMap((c) => {
              const g = (o.goods ?? []).find((x) => x.id === c.good);
              const have = g ? (larder?.find((h) => h.unit === goodUnit(g))?.amount ?? 0) : 0;
              return g ? [{ name: g.name, have }] : [];
            }),
            o.buyCraving,
          ).filter((n) => !pantryTrade.has(n))
        : [];
      const buyAll = [...new Set([...buyOnly, ...craveBuy])];
      const withBuy =
        buyAll.length > 0 ? { ...pantry, trade: [...pantryTrade, ...buyAll].sort() } : pantry;
      // Ansia sin la sustancia ni con quién comprarla: recolectar la planta que el catálogo rinde.
      const gatherYields = new Set(
        o.catalog.verbs
          .filter((v) => v.id === "gather")
          .flatMap((v) => v.yields.map((y) => y.good)),
      );
      const craveGather = o.gatherCraving
        ? cravingBuyGoods(
            mood.craving,
            (o.consumables ?? []).flatMap((c) => {
              const g = (o.goods ?? []).find((x) => x.id === c.good);
              if (!g || !gatherYields.has(g.id)) return [];
              const have = larder?.find((h) => h.unit === goodUnit(g))?.amount ?? 0;
              return [{ name: g.name, have }];
            }),
            o.gatherCraving,
          )
        : [];
      const withGather = craveGather.length > 0 ? { ...withBuy, gather: craveGather } : withBuy;
      // Sin con quién comprar ni planta: pedírsela a quien oyó que la tiene (opt-in `borrowCraving`).
      const craveBorrow =
        o.borrowCraving && hintBook && craveBuy.length === 0 && craveGather.length === 0
          ? cravingBorrowAsks(
              mood.craving,
              (o.consumables ?? []).flatMap((c) => {
                const g = (o.goods ?? []).find((x) => x.id === c.good);
                const have = g ? (larder?.find((h) => h.unit === goodUnit(g))?.amount ?? 0) : 0;
                return g ? [{ name: g.name, have }] : [];
              }),
              hintBook.items,
              new Set(people.map((p) => p.id as string)),
              o.borrowCraving,
            )
          : [];
      const texts = stash.length > 0 ? { ...withGather, consume: stash.sort() } : withGather;
      const social: Candidate[] = [];
      const catalogCandidates: Candidate[] = verbCandidates({
        catalog: o.catalog,
        view,
        persons: people.map((p) => p.id as unknown as EntityRef),
        // Los lugares con nombre de la aldea que conoce (los vive todos los días).
        places: truth.ids(PLACE).map((id) => id as unknown as EntityRef),
        texts,
      });
      // Sed alta con agua sin tratar: hervir también apaga la sed (de lo que traería el agua cruda).
      if (
        o.boilThirst &&
        (drives.needs.thirst ?? 0) >= o.boilThirst.minThirst &&
        (truth.get(TREATED_WATER, me)?.until ?? -1) < now
      ) {
        catalogCandidates.push({
          id: "boil:",
          verb: "boil",
          contributes: { thirst: o.boilThirst.weight },
          chance: 0.9,
          loss: STAKES_RISK.none.loss,
        });
      }
      // Hogar que cree artesano de un oficio que necesita: contratarlo o comprarle (opt-in `tradeWant`);
      // solo con los verbos que el catálogo tiene, y el ánimo lo pone `moldHintMood`.
      if (o.moldHints?.tradeWant) {
        for (const verb of CRAFTSMAN_VERBS) {
          if (!o.catalog.verbs.some((v) => v.id === verb)) continue;
          for (const home of moldCraftsmen(hintBook, o.moldHints)) {
            catalogCandidates.push({
              id: `${verb}:${home}`,
              verb,
              target: home,
              contributes: {},
              chance: 0.6,
              loss: STAKES_RISK.none.loss,
            });
          }
        }
      }
      for (const p of people) {
        const confidence = (() => {
          const alive = believed(beliefs, p.id, "alive");
          return alive ? beliefConfidenceAt(alive, now) : 0.3;
        })();
        // Lo que la vio hacer: si fue algo de riesgo, la cree peligrosa en proporción.
        const seen = believed(beliefs, p.id, "action");
        const seenDef =
          seen && typeof seen.value === "string"
            ? o.catalog.verbs.find((v) => v.id === seen.value)
            : undefined;
        const seenHarm =
          seen && seenDef ? STAKES_RISK[seenDef.stakes].risk * beliefConfidenceAt(seen, now) : 0;
        social.push(
          ...socialCandidates({
            target: p.id,
            dims: p.rel.dims,
            bonds: p.rel.bonds,
            belief: otherBeliefFrom({
              who: p.id,
              memories,
              now,
              relFear: p.rel.dims.fear,
              seenHarm,
              confidence,
            }),
            means: { surplus: Math.max(0, 1 - (drives.needs.hunger ?? 0) * 2) },
          }),
        );
      }
      for (const ask of craveBorrow) {
        catalogCandidates.push({
          id: `speak:${ask.lender}+borrow:${ask.name}`,
          verb: "speak",
          target: ask.lender,
          contributes: { craving: 0.5 },
          chance: 0.6,
          loss: STAKES_RISK.none.loss,
          mood: cravingBorrowMood(
            mood.craving,
            ask.confidence,
            o.borrowCraving as BorrowCravingOptions,
          ),
        });
      }
      // Cree al prestamista en otro lado (creencia de ubicación): ir hacia el lugar donde lo cree.
      if (o.borrowCraving?.approach !== undefined && craveBorrow.length > 0) {
        const placeAt = (hex: number) =>
          truth.ids(PLACE).find((id) => truth.get(PLACE, id)?.hexes.includes(hex));
        for (const m of cravingApproachMoves(
          craveBorrow,
          (lender) => {
            const b = believed(beliefs, lender as unknown as AgentId, "at");
            return b && typeof b.value === "object" ? b.value.hex : undefined;
          },
          here,
          (hex) => placeAt(hex) as string | undefined,
          mood.craving,
          o.borrowCraving,
        )) {
          catalogCandidates.push({
            id: m.id,
            verb: "move",
            target: m.place as unknown as EntityRef,
            contributes: { craving: 0.3 },
            chance: 0.8,
            loss: STAKES_RISK.none.loss,
            mood: m.mood,
          });
        }
      }
      // Modificadores (g): memorias, hábitos, disonancia con valores y evitación por trauma; sin
      // esos insumos las candidatas quedan iguales.
      const merged = mergeCandidates(catalogCandidates, social);
      const hinted =
        o.moldHints && hintBook
          ? merged.map((c) => {
              // Las que nombran un bien de la despensa ofrecen vender; las de compra, un bien oído barato.
              const buying = c.verb === "trade" && buyOnly.some((n) => c.id.endsWith(`+${n}`));
              const bump = moldHintMood(
                c.verb === "trade" ? { ...c, direction: buying ? "buy" : "sell" } : c,
                hintBook,
                o.moldHints,
                hintPriced,
              );
              return bump === 0 ? c : { ...c, mood: r((c.mood ?? 0) + bump) };
            })
          : merged;
      const craved =
        craveBuy.length > 0 && o.buyCraving
          ? hinted.map((c) => {
              const name =
                c.verb === "trade" ? craveBuy.find((n) => c.id.endsWith(`+${n}`)) : undefined;
              if (name === undefined) return c;
              const perKg = o.moldHints?.believedPerKg?.(hintPriced.beliefs, name, hintPriced.day);
              return {
                ...c,
                mood: r(
                  (c.mood ?? 0) +
                    cravingBuyMood(mood.craving, perKg, o.buyCraving as BuyCravingOptions),
                ),
              };
            })
          : hinted;
      // Recolectar solo empuja si no hay con quién comprar ese bien (ninguna `trade` lo nombra).
      const gathered =
        craveGather.length > 0 && o.gatherCraving
          ? craved.map((c) => {
              const name =
                c.verb === "gather" ? craveGather.find((n) => c.id.endsWith(`+${n}`)) : undefined;
              if (name === undefined) return c;
              if (craved.some((t) => t.verb === "trade" && t.id.endsWith(`+${name}`))) return c;
              return {
                ...c,
                mood: r(
                  (c.mood ?? 0) +
                    cravingGatherMood(mood.craving, o.gatherCraving as GatherCravingOptions),
                ),
              };
            })
          : craved;
      const candidates = modifyCandidates(gathered, {
        now,
        memories,
        habits: verbHabits(o.habits ?? [], truth.get(HABITS, me), now),
        values: drives.values,
        mental: truth.get(MENTAL, me),
        // Tabú creído sobre el bien que toma la candidata (hoy ninguna candidata nombra uno).
        sanction: sanctionFor(
          (good) =>
            sanctionWeight(truth.get(RELIGIOUS_IDENTITY, me), villageReligion(truth), good).penalty,
        ),
      });
      if (candidates.length === 0) return { changes: goalChange, events: goalEvents };

      const choice = decideByUtility(
        candidates,
        layerDrives(goalDrives(drives, goals), layered),
        innate,
        temper,
        ctx.rng.fork("decision", me, now),
      );
      if (!choice) return { changes: goalChange, events: goalEvents };
      const c = choice.candidate;
      const decision: Decision = {
        at: now,
        id: c.id,
        verb: c.verb,
        ...(c.target === undefined ? {} : { target: c.target }),
        utility: r(choice.utility),
        options: candidates.length,
      };
      const prev = truth.get(NPC_DECISION, me);
      const changed = !prev || prev.verb !== c.verb || prev.target !== c.target;
      return {
        changes: [setComponent(NPC_DECISION, me, decision), ...goalChange],
        events: [
          ...goalEvents,
          ...(changed
            ? [
                {
                  kind: DECIDED_EVENT,
                  actors: [me],
                  place: o.placeOf(truth, me),
                  data: {
                    choice: c.id,
                    verb: c.verb,
                    ...(c.target === undefined ? {} : { target: c.target }),
                    utility: decision.utility,
                    options: candidates.length,
                    ...(prev ? { was: prev.id } : {}),
                  },
                  emissions: {},
                  causes: [{ kind: "state", entity: me, key: "utility" } as const],
                },
              ]
            : []),
        ],
      };
    },
  };
}
