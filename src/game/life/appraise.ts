// El appraisal de la vida (npc-psychology §3, Fase 2): lo que les pasa a los vecinos los marca según
// quiénes son. Al cerrar cada paso, quien peleó interpreta la pelea con su temperamento y sus
// esquemas, y la casa y la sangre de quien murió lo viven como pérdida; cada estímulo pasa por
// `form` y mueve los esquemas citando el evento. Quien lo vive lo sabe por haber estado ahí o por
// ser de la casa del muerto: los NPC todavía no perciben a distancia (Fase 3).
//
// También lleva los hábitos: cada acción registrada los refuerza (`sim/mind/habits.ts`).
// También mueve las relaciones (`RELATIONS`) de quienes pelearon, remataron o perdonaron, y de
// quienes se dieron, comerciaron, se curaron, se fiaron, se devolvieron o no se pagaron.
// Y guarda lo vivido como memoria episódica (`MEMORIES`, `sim/mind/memory.ts`; `memories.ts`).

import type { AgentId, Event, PlanetClock } from "../../core/index.ts";
import {
  addMemory,
  applyDeltas,
  appraiseFight,
  appraiseGuilt,
  appraiseHardship,
  appraiseLoss,
  appraiseRearing,
  BODY_STATE,
  type BondDef,
  contactGain,
  type Deltas,
  type DimensionDef,
  defaultDeltas,
  ENTITY,
  emptyMental,
  fightDeltas,
  finishDeltas,
  form,
  formMemory,
  giveDeltas,
  guiltOf,
  HABITS,
  type HabitDef,
  habitsFed,
  INNATE,
  killAftermath,
  lendDeltas,
  MEMORIES,
  MENTAL,
  type Memories,
  type MentalState,
  MIND,
  type Mind,
  numbedIntensity,
  numbedStimulus,
  OWN_DEEDS,
  type OwnDeeds,
  openCondition,
  PERSON,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  type Relations,
  reinforceAll,
  relationship,
  rememberOwn,
  repaidDeltas,
  type SchemaDef,
  type StageDef,
  type StateChange,
  setComponent,
  spareDeltas,
  stageAt,
  TALK_FAMILIARITY,
  type Trait,
  tendDeltas,
  tradeDeltas,
  weaken,
} from "../../sim/index.ts";

import { conscienceOf, ownDeedOf } from "./conscience.ts";
import { creditRows } from "./credit.ts";
import { type Lived, livedFrom, lossLived } from "./memories.ts";

export const APPRAISE_PROCESS = "life.appraise";

export interface AppraiseOptions {
  readonly clock: PlanetClock;
  readonly schemas: readonly SchemaDef[];
  readonly stages: readonly StageDef[];
  readonly dims: readonly DimensionDef[];
  readonly bonds: readonly BondDef[];
  readonly habits: readonly HabitDef[];
  readonly traits: readonly Trait[];
}

/** Cercanía (0-1) de `from` hacia `to` leída de la relación: cariño, trato y dependencia. */
export function closeness(rel: ReturnType<typeof relationship>): number {
  const d = rel.dims;
  const x = 0.5 * Math.max(0, d.affection) + 0.3 * d.familiarity + 0.2 * d.dependency;
  return Math.min(1, Math.max(0, x));
}

function alive(truth: ReadonlyWorldTruth, id: AgentId): boolean {
  return truth.get(ENTITY, id)?.endedAt === undefined;
}

export function appraiseProcess(o: AppraiseOptions): ProcessDef {
  return {
    id: APPRAISE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "perceive",
    reads: [
      MIND.name,
      INNATE.name,
      PERSON.name,
      ENTITY.name,
      RELATIONS.name,
      HABITS.name,
      MEMORIES.name,
      MENTAL.name,
      BODY_STATE.name,
      OWN_DEEDS.name,
    ],
    writes: [MIND.name, HABITS.name, RELATIONS.name, MEMORIES.name, MENTAL.name, OWN_DEEDS.name],
    run(ctx) {
      const truth = ctx.truth;
      const minds = new Map<AgentId, Mind>();
      const habits = new Map<AgentId, ReturnType<typeof reinforceAll>["habits"]>();
      const apply = (id: AgentId, e: Event, items: ReturnType<typeof appraiseLoss>) => {
        const person = truth.get(PERSON, id);
        const innate = truth.get(INNATE, id);
        const mind = minds.get(id) ?? truth.get(MIND, id);
        if (!person || !innate || !mind || items.length === 0) return;
        const stage = stageAt(o.stages, (e.tick - person.born) / o.clock.year);
        let next = mind;
        for (const a of items) {
          // El entumecimiento también apaga lo bueno que forma la mente.
          const stimulus = numbedStimulus(a.stimulus, mentals.get(id) ?? truth.get(MENTAL, id));
          next = form(next, stimulus, { schemas: o.schemas, stage, innate, event: e.id }).mind;
        }
        minds.set(id, next);
      };
      const rels = new Map<AgentId, Relations>();
      const rel = (from: AgentId, to: AgentId, e: Event) =>
        relationship(rels.get(from) ?? truth.get(RELATIONS, from), to, e.tick, {
          dims: o.dims,
          bonds: o.bonds,
          schemaStrength: (s) => truth.get(MIND, from)?.schemas[s]?.strength ?? 0,
        });
      // Lo que `from` siente por `to` cambia por `deltas`; cita el evento. Quien no tenía fila la abre.
      const move = (from: AgentId, to: AgentId, e: Event, deltas: Deltas) => {
        if (!alive(truth, from) || !truth.get(PERSON, from)) return;
        const base = rels.get(from) ??
          truth.get(RELATIONS, from) ?? { toward: {}, originEventId: e.id };
        const next = applyDeltas(rel(from, to, e), deltas, e.id);
        rels.set(from, { ...base, toward: { ...base.toward, [to]: { ...next, updated: e.tick } } });
      };
      const mentals = new Map<AgentId, MentalState>();
      const mems = new Map<AgentId, Memories>();
      const note = (l: Lived) => {
        if (!alive(truth, l.who) || !truth.get(PERSON, l.who)) return;
        // El entumecimiento apaga lo positivo: lo bueno se vive (y se guarda) con menos intensidad.
        const ex = l.experience;
        const m = formMemory({
          ...ex,
          intensity: numbedIntensity(
            ex.intensity,
            ex.valence,
            mentals.get(l.who) ?? truth.get(MENTAL, l.who),
          ),
        });
        mems.set(l.who, addMemory(mems.get(l.who) ?? truth.get(MEMORIES, l.who), m, m.at));
      };
      const owns = new Map<AgentId, OwnDeeds>();
      for (const e of ctx.recent) {
        for (const l of livedFrom(e)) note(l);
        // Quien hizo algo lo sabe, lo haya visto alguien o no: lo anota y lo carga (law §15).
        const own = ownDeedOf(truth, e);
        if (own && alive(truth, own.by) && truth.get(PERSON, own.by)) {
          const { by, deed, fatal } = own;
          owns.set(by, rememberOwn(owns.get(by) ?? truth.get(OWN_DEEDS, by), deed));
          // Una muerte la carga `killAppraisals` (culpa y trauma); el resto, acá con `guiltOf`.
          const guilt = guiltOf(deed, conscienceOf(truth, o, by, deed, e.tick), e.tick);
          if (!fatal && guilt > 0) {
            apply(by, e, appraiseGuilt(guilt));
            const mental = mentals.get(by) ?? truth.get(MENTAL, by) ?? emptyMental(e.id, e.tick);
            mentals.set(
              by,
              openCondition(
                mental,
                "guilt",
                guilt,
                e.id,
                { who: deed.victim, place: e.place },
                e.tick,
              ),
            );
          }
        }
        const fed = habitsFed(o.habits, e.kind);
        const doer = e.actors[0] as AgentId | undefined;
        if (fed.length > 0 && doer && alive(truth, doer) && truth.get(PERSON, doer)) {
          const r = reinforceAll(habits.get(doer) ?? truth.get(HABITS, doer), fed, e.tick, e.id);
          habits.set(doer, r.habits);
          // Un hábito que se asienta deja su marca, una sola vez, como un evento vivido.
          for (const def of r.settled) {
            if (def.stimulus) apply(doer, e, [{ stimulus: def.stimulus, blame: null }]);
          }
        }
        if (e.kind === "action.speak") {
          talked(e, truth, rel, move);
          const lie = lieTold(e);
          if (lie && alive(truth, lie.liar) && truth.get(PERSON, lie.liar)) {
            const lying = habitsFed(o.habits, LIE_HABIT_KIND);
            const cur = habits.get(lie.liar) ?? truth.get(HABITS, lie.liar);
            if (lie.caught) {
              // Descubierto: el hábito se enfría de golpe y queda el fracaso (dialogue §4).
              habits.set(lie.liar, weaken(cur, lying, e.tick, LIE_CAUGHT_KEEP));
              apply(lie.liar, e, [{ stimulus: LIE_CAUGHT_STIMULUS, blame: null }]);
            } else if (lying.length > 0) {
              const r = reinforceAll(cur, lying, e.tick, e.id);
              habits.set(lie.liar, r.habits);
              for (const def of r.settled) {
                if (def.stimulus) apply(lie.liar, e, [{ stimulus: def.stimulus, blame: null }]);
              }
            }
          }
        }
        const lent = lentIn(e);
        if (lent) {
          move(lent.creditor, lent.debtor, e, lendDeltas("lender"));
          move(lent.debtor, lent.creditor, e, lendDeltas("borrower"));
        }
        if (e.kind === "combat.fight" || e.kind === "combat.finish") {
          fightAppraisals(e, truth, apply, rel, move);
          killAppraisals(e, truth, apply, rel, mentals);
        } else if (e.kind === "combat.spare") {
          const [sparer, spared] = e.actors as [AgentId | undefined, AgentId | undefined];
          if (sparer && spared) {
            move(spared, sparer, e, spareDeltas("spared"));
            move(sparer, spared, e, spareDeltas("sparer"));
          }
        } else if (
          e.kind === "action.give" ||
          e.kind === "action.trade" ||
          e.kind === "action.tend"
        ) {
          dealings(e, truth, move);
        } else if (e.kind === "household.repaid") {
          const [debtor, creditor] = e.actors as [AgentId | undefined, AgentId | undefined];
          if (debtor && creditor) {
            move(creditor, debtor, e, repaidDeltas("creditor"));
            move(debtor, creditor, e, repaidDeltas("debtor"));
          }
        } else if (
          e.kind === "law.default" ||
          e.kind === "contract.pledge_broken" ||
          e.kind === "contract.pledge_disputed"
        ) {
          const [debtor, creditor] = e.actors as [AgentId | undefined, AgentId | undefined];
          if (debtor && creditor) {
            const empty = { schemas: {}, formative: [], originEventId: e.id };
            // Una promesa rota pega según lo que se jugaba: de la mitad a una vez y media un default.
            const stake = (e.data as { weight?: number } | null)?.weight;
            const scale = stake === undefined ? 1 : 0.5 + stake;
            move(
              creditor,
              debtor,
              e,
              defaultDeltas("creditor", truth.get(MIND, creditor) ?? empty, scale),
            );
            move(debtor, creditor, e, defaultDeltas("debtor", empty));
          }
        } else if (e.kind === "mind.hardship") {
          const id = e.actors[0] as AgentId | undefined;
          const ratio = (e.data as { fatRatio?: number } | null)?.fatRatio;
          const mind = id ? truth.get(MIND, id) : undefined;
          if (id && mind && ratio !== undefined && alive(truth, id)) {
            apply(id, e, appraiseHardship(ratio, minds.get(id) ?? mind));
          }
        } else if (e.kind === "family.rearing") {
          const [id, by] = e.actors as [AgentId | undefined, AgentId | undefined];
          const data = (e.data ?? {}) as { care?: number; harsh?: number };
          const mind = id ? truth.get(MIND, id) : undefined;
          const innate = id ? truth.get(INNATE, id) : undefined;
          if (id && mind && innate && alive(truth, id)) {
            const facts = { caregiver: by ?? null, care: data.care ?? 0, harsh: data.harsh ?? 0 };
            apply(id, e, appraiseRearing(facts, minds.get(id) ?? mind, innate));
          }
        } else if (e.kind === "body.died") {
          const dead = e.actors[0] as AgentId | undefined;
          const home = dead ? truth.get(PERSON, dead)?.household : undefined;
          if (!dead || home === undefined) continue;
          for (const id of truth.ids(PERSON) as AgentId[]) {
            if (id === dead || !alive(truth, id) || truth.get(PERSON, id)?.household !== home) {
              continue;
            }
            const r = rel(id, dead, e);
            if (r.bonds.length === 0) continue;
            apply(id, e, appraiseLoss(closeness(r)));
            note(lossLived(e, id, dead, closeness(r)));
          }
        }
      }
      const changes: StateChange[] = [
        ...[...minds].map(([id, m]) => setComponent(MIND, id, m)),
        ...[...habits].map(([id, h]) => setComponent(HABITS, id, h)),
        ...[...rels].map(([id, r]) => setComponent(RELATIONS, id, r)),
        ...[...mems].map(([id, m]) => setComponent(MEMORIES, id, m)),
        ...[...mentals].map(([id, m]) => setComponent(MENTAL, id, m)),
        ...[...owns].map(([id, d]) => setComponent(OWN_DEEDS, id, d)),
      ];
      return changes.length === 0 ? {} : { changes };
    },
  };
}

interface FightData {
  readonly outcomes?: Readonly<Record<string, string>>;
  readonly hits?: readonly { by?: string; to?: string; severity?: number }[];
}

function fightAppraisals(
  e: Event,
  truth: ReadonlyWorldTruth,
  apply: (id: AgentId, e: Event, items: ReturnType<typeof appraiseLoss>) => void,
  rel: (from: AgentId, to: AgentId, e: Event) => ReturnType<typeof relationship>,
  move: (from: AgentId, to: AgentId, e: Event, deltas: Deltas) => void,
): void {
  const [first, second] = e.actors as [AgentId | undefined, AgentId | undefined];
  if (!first || !second) return;
  const data = (e.data ?? {}) as FightData;
  const worstOn = (id: AgentId) =>
    Math.max(0, ...(data.hits ?? []).filter((h) => h.to === id).map((h) => h.severity ?? 0));
  // Un remate (`combat.finish`) no trae el desenlace: el golpeado no está de pie.
  const standing = (id: AgentId) =>
    e.kind === "combat.fight" ? (data.outcomes?.[id] ?? "standing") === "standing" : id === first;
  const pairs: [AgentId, AgentId, "aggressor" | "victim"][] = [
    [first, second, "aggressor"],
    [second, first, "victim"],
  ];
  for (const [me, foe, role] of pairs) {
    if (!alive(truth, me)) continue;
    const r = rel(me, foe, e);
    const facts = {
      role,
      foe,
      worst: role === "victim" ? worstOn(me) : worstOn(foe),
      standing: standing(me),
      kin: r.bonds.length > 0,
    } as const;
    const mind = truth.get(MIND, me) ?? { schemas: {}, formative: [], originEventId: e.id };
    const innate = truth.get(INNATE, me) ?? {};
    apply(me, e, appraiseFight(facts, mind, innate));
    // Un remate no es una pelea: el que se rindió y lo golpearon lo vive como traición.
    move(
      me,
      foe,
      e,
      e.kind === "combat.finish" && role === "victim"
        ? finishDeltas()
        : fightDeltas(facts, mind, innate),
    );
  }
}

/** El hábito de mentir se alimenta de este tipo sintético (`content/habits`, campo `kinds`). */
export const LIE_HABIT_KIND = "speak.lie";
/** Lo que queda del hábito al ser descubierto, y el fracaso que deja (sin calibrar). */
const LIE_CAUGHT_KEEP = 0.5;
const LIE_CAUGHT_STIMULUS = { theme: "failure", intensity: 0.3 } as const;

/**
 * Una mentira que el oyente juzgó (dialogue §4): `judged.certain` dice si el veredicto acertó, así
 * que quien habló mintió si lo descubrieron con acierto (`caught`) o si lo creyeron pese a no
 * ser cierto (la mentira rinde). Una mentira apenas dudada no mueve el hábito, ni la acusación
 * equivocada a quien decía la verdad.
 */
export function lieTold(e: Event): { liar: AgentId; caught: boolean } | null {
  const liar = e.actors[1] as AgentId | undefined;
  const eff = (
    e.data as {
      effect?: { kind?: string; judged?: { verdict?: string; certain?: boolean } };
    } | null
  )?.effect;
  if (!liar || eff?.kind !== "speak" || !eff.judged) return null;
  const { verdict, certain } = eff.judged;
  if (verdict === "caught" && certain === true) return { liar, caught: true };
  if (verdict === "believed" && certain === false) return { liar, caught: false };
  return null;
}

/** Una charla entregada: ambos se conocen un poco más, cada quien según lo que ya se conocía. */
function talked(
  e: Event,
  truth: ReadonlyWorldTruth,
  rel: (from: AgentId, to: AgentId, e: Event) => ReturnType<typeof relationship>,
  move: (from: AgentId, to: AgentId, e: Event, deltas: Deltas) => void,
): void {
  const [a, b] = e.actors as [AgentId | undefined, AgentId | undefined];
  const eff = (
    e.data as {
      effect?: {
        kind?: string;
        delivered?: boolean;
        judged?: { trustDelta?: number };
        regard?: { deltas?: Deltas };
        form?: { deltas?: Deltas };
        keep?: { trustDelta?: number };
      };
    } | null
  )?.effect;
  if (!a || !b || a === b || eff?.kind !== "speak" || eff.delivered === false) return;
  if (!alive(truth, a) || !alive(truth, b)) return;
  // Quien oyó (a) juzgó lo que le contaron: su confianza en quien habló (b) sube o baja.
  const trust = eff.judged?.trustDelta ?? 0;
  if (trust !== 0) move(a, b, e, { trust });
  // Una amenaza, un halago o un insulto (dialogue §9, §10): lo que dejó en lo que a siente por b.
  if (eff.regard?.deltas) move(a, b, e, eff.regard.deltas);
  // El registro o la palabra vedada fuera de lugar (dialogue §10): rencor y respeto perdido.
  if (eff.form?.deltas && Object.keys(eff.form.deltas).length > 0) move(a, b, e, eff.form.deltas);
  // Quien guardaba un secreto y notó que lo sonsacaban confía menos en quien preguntó (dialogue §11).
  const probed = eff.keep?.trustDelta ?? 0;
  if (probed !== 0) move(a, b, e, { trust: probed });
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    const gain = contactGain(TALK_FAMILIARITY, rel(from, to, e).dims.familiarity);
    if (gain > 0) move(from, to, e, { familiarity: gain });
  }
}

/** Un fiado concedido, de palabra (`action.speak`) o por el hogar (`household.borrowed`). */
function lentIn(e: Event): { creditor: AgentId; debtor: AgentId } | null {
  if (e.kind !== "action.speak" && e.kind !== "household.borrowed") return null;
  if (!(e.data as { credit?: unknown } | null)?.credit) return null;
  const [creditor, debtor] = e.actors as [AgentId | undefined, AgentId | undefined];
  return creditor && debtor ? { creditor, debtor } : null;
}

interface DealingData {
  readonly effect?: {
    readonly kind?: string;
    readonly to?: string;
    readonly with?: string;
    readonly target?: string;
    readonly good?: string | null;
    readonly grams?: number;
    readonly deal?: boolean;
    readonly edge?: number;
    readonly done?: boolean;
    readonly care?: number;
  };
}

/** Dar, comerciar y curar: lo que cada parte siente por la otra según lo que pasó de verdad. */
function dealings(
  e: Event,
  truth: ReadonlyWorldTruth,
  move: (from: AgentId, to: AgentId, e: Event, deltas: Deltas) => void,
): void {
  const actor = e.actors[0] as AgentId | undefined;
  const eff = (e.data as DealingData | null)?.effect;
  if (!actor || !eff) return;
  if (eff.kind === "give" && eff.to && eff.good && (eff.grams ?? 0) > 0) {
    const to = eff.to as AgentId;
    // Era una devolución si el que da le debía (o le debió) algo de eso al que recibe.
    const repayment = creditRows(truth).some(
      (r) => r.credit.debtor === actor && r.credit.creditor === to && r.credit.unit === eff.good,
    );
    move(to, actor, e, giveDeltas("receiver", eff.grams ?? 0, repayment));
    move(actor, to, e, giveDeltas("giver", eff.grams ?? 0, repayment));
  } else if (
    eff.kind === "trade" &&
    eff.deal &&
    eff.with &&
    (eff as { direction?: string | null }).direction != null
  ) {
    const other = eff.with as AgentId;
    move(actor, other, e, tradeDeltas("actor", eff.edge ?? 0));
    move(other, actor, e, tradeDeltas("other", eff.edge ?? 0));
  } else if (eff.kind === "tend" && eff.done && eff.target && eff.target !== actor) {
    const cared = eff.target as AgentId;
    move(cared, actor, e, tendDeltas("cared", eff.care ?? 0));
    move(actor, cared, e, tendDeltas("carer", eff.care ?? 0));
  }
}

/**
 * Quien mató lo carga (combat §11, npc-psychology §11): `killAftermath` pesa la culpa y el trauma con
 * lo que pasó (si el muerto se defendía, qué tan cerca estaban, cuánta sangre) y con quién es el
 * que mató; los estímulos pasan por `form` y la condición queda abierta citando el evento, con el
 * muerto y el lugar como disparadores. La cultura y el apoyo todavía no entran (condena y apoyo en 0).
 */
function killAppraisals(
  e: Event,
  truth: ReadonlyWorldTruth,
  apply: (id: AgentId, e: Event, items: ReturnType<typeof appraiseLoss>) => void,
  rel: (from: AgentId, to: AgentId, e: Event) => ReturnType<typeof relationship>,
  mentals: Map<AgentId, MentalState>,
): void {
  const [first, second] = e.actors as [AgentId | undefined, AgentId | undefined];
  if (!first || !second) return;
  const data = (e.data ?? {}) as FightData;
  const pairs: [AgentId, AgentId, "aggressor" | "victim"][] = [
    [first, second, "aggressor"],
    [second, first, "victim"],
  ];
  for (const [killer, dead, role] of pairs) {
    // Un remate solo lo da quien golpea; en una pelea el desenlace dice quién murió.
    const died =
      e.kind === "combat.fight"
        ? data.outcomes?.[dead] === "dead"
        : role === "aggressor" && truth.get(BODY_STATE, dead)?.death != null;
    if (!died || !alive(truth, killer) || !truth.get(PERSON, killer)) continue;
    const innate = truth.get(INNATE, killer) ?? {};
    const mind = truth.get(MIND, killer);
    const mental = mentals.get(killer) ?? truth.get(MENTAL, killer) ?? emptyMental(e.id, e.tick);
    const worst = Math.max(
      0,
      ...(data.hits ?? []).filter((h) => h.to === dead).map((h) => h.severity ?? 0),
    );
    const result = killAftermath(
      {
        defenseless: e.kind === "combat.finish",
        closeness: closeness(rel(killer, dead, e)),
        selfDefense: e.kind === "combat.fight" && role === "victim",
        condemned: 0,
        hadChoice: e.kind === "combat.finish" ? 1 : role === "aggressor" ? 0.5 : 0.1,
        gore: worst,
        priorKills: mental.kills,
      },
      {
        z: innate,
        schemas: Object.fromEntries(
          Object.entries(mind?.schemas ?? {}).map(([k, v]) => [k, v.strength]),
        ),
      },
    );
    apply(
      killer,
      e,
      result.stimuli.map((stimulus) => ({ stimulus, blame: null })),
    );
    const trigger = { who: dead, place: e.place };
    let next: MentalState = { ...mental, kills: mental.kills + 1 };
    next = openCondition(next, "trauma", result.trauma, e.id, trigger, e.tick);
    next = openCondition(next, "guilt", result.guilt, e.id, trigger, e.tick);
    mentals.set(killer, next);
  }
}
