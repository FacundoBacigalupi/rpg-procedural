// Sustancias cableadas a la vida (body-health §9): cada día, en pasos de una hora, lo que cada
// persona tiene en el cuerpo se absorbe, se metaboliza y daña o se repara (`stepSubstance`). Las
// dosis vienen de una fuente explícita (`SubstanceDose`: un escenario, un envenenador, una
// receta); la sustancia es una entidad con origen la primera vez que se usa. El estado vive en
// `PERSON_SUBSTANCE`, aparte del `Body`. Sin dosis ni filas el proceso no hace nada (ni RNG), así
// que la aldea por defecto no cambia. Si el daño llega al total, muere con causa `poison`.

import type { AgentId, PlaceRef, PlanetClock, Tick } from "../../core/index.ts";
import {
  type AcuteEffects,
  acuteEffects,
  BODY_STATE,
  CLEAN,
  type CueContext,
  createEntity,
  cueCraving,
  draftEvent,
  ENTITY,
  type EventDraft,
  endEntity,
  type HeldSubstance,
  LOCATION,
  learnCues,
  type MoldRumor,
  NEUTRAL,
  PERSON,
  PERSON_SUBSTANCE,
  type ProcessContext,
  type ProcessDef,
  pruneCues,
  type ReadonlyWorldTruth,
  type StateChange,
  SUBSTANCE,
  type SubstanceDef,
  type SubstanceRoute,
  type SubstanceState,
  setComponent,
  stepSubstance,
  substanceDeath,
  TREATMENT,
  dose as takeDose,
} from "../../sim/index.ts";

/** Lo que alguien tiene en el cuerpo y sus efectos agudos; sin filas, `NEUTRAL` (no cambia nada). */
export function acuteOf(truth: ReadonlyWorldTruth, who: AgentId): AcuteEffects {
  const rows = truth.get(PERSON_SUBSTANCE, who as never)?.held;
  if (!rows || rows.length === 0) return NEUTRAL;
  const defs = new Map<string, SubstanceDef>();
  for (const id of truth.ids(SUBSTANCE)) {
    const rec = truth.get(SUBSTANCE, id);
    if (rec) defs.set(rec.def.id, rec.def);
  }
  const held = [];
  for (const h of rows) {
    const def = defs.get(h.substance);
    if (def) held.push({ def, state: h.state });
  }
  return acuteEffects(held);
}

/** Vida media de una señal sin reforzarse: dos meses de mundo. */
export const CUE_HALF_LIFE_DAYS = 60;
export const cueHalfLife = (clock: PlanetClock): number => CUE_HALF_LIFE_DAYS * clock.day;

/** El entorno de alguien ahora: su hex, quiénes están en el mismo hex y la hora (sin huso). */
export function cueContextOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  now: number,
  clock: PlanetClock,
  /**
   * Opt-in: `believedPresent` son las personas que quien siente CREE presentes (sustituye a "las del
   * mismo hex": una creencia falsa despierta la señal, una persona oculta no) y `hourOffset` el huso
   * local en horas respecto de la hora global. Sin esto, el entorno es el de siempre.
   */
  local?: {
    readonly believedPresent?: readonly string[];
    readonly hourOffset?: number;
    /** Objetos u olores presentes (señal por objeto). */
    readonly objects?: readonly string[];
  },
): CueContext {
  const hex = truth.get(LOCATION, who)?.hex ?? 0;
  const people =
    local?.believedPresent !== undefined
      ? local.believedPresent.filter((id) => id !== who && id.startsWith("agent:"))
      : truth
          .ids(LOCATION)
          .filter(
            (id) => id !== who && id.startsWith("agent:") && truth.get(LOCATION, id)?.hex === hex,
          )
          .map(String);
  const inDay = ((now % clock.day) + clock.day) % clock.day;
  const hour = Math.floor((inDay / clock.day) * 24);
  const off = Math.round(local?.hourOffset ?? 0);
  const hourLocal = (((hour + off) % 24) + 24) % 24;
  return local?.objects !== undefined && local.objects.length > 0
    ? { hex, people, hour: hourLocal, objects: local.objects }
    : { hex, people, hour: hourLocal };
}

/** Ansia que despierta el entorno por señales aprendidas; sin señales (o sin opt-in), 0. */
export function cueCravingOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  ctx: CueContext,
  now: number,
  clock: PlanetClock,
): number {
  const cues = truth.get(PERSON_SUBSTANCE, who as never)?.cues;
  return cues ? cueCraving(cues, ctx, now, cueHalfLife(clock)) : 0;
}

export const SUBSTANCES_PROCESS = "life.substances";

/** Una unidad del ledger que es una sustancia de consumo: tomarla es una dosis (opt-in en `ActOptions`). */
export interface ConsumableDef {
  /** Id del bien (`GoodDef.id`) que se gasta al tomarla. */
  readonly good: string;
  readonly def: SubstanceDef;
  readonly route: SubstanceRoute;
  /** Cantidad por dosis (una unidad del bien). */
  readonly amount: number;
}

/** La dosis de `c` para una cantidad (`amount` por gramo o por litro) de lo ingerido. */
export function scaledDose(c: ConsumableDef, quantity: number): ConsumableDef {
  return { ...c, amount: c.amount * quantity };
}

/** Opt-in de `decide`: el ansia empuja a comprar lo que se consume y no está en la despensa. */
export interface BuyCravingOptions {
  /** Ansia mínima (0-1) para que la compra entre como candidata. */
  readonly minCraving: number;
  /** Peso del empuje con el ansia al máximo y precio nulo. */
  readonly weight: number;
  /** Precio por kilo (monedas) en que el empuje se reduce a la mitad; por defecto 10. */
  readonly refPrice?: number;
}

/** Nombres de bienes de consumo a comprar (puro): ansia alta y sin existencias; orden por nombre. */
export function cravingBuyGoods(
  craving: number,
  names: readonly { readonly name: string; readonly have: number }[],
  o: BuyCravingOptions,
): string[] {
  if (craving < o.minCraving) return [];
  return names
    .filter((n) => n.have < 1)
    .map((n) => n.name)
    .sort();
}

/** Empuje de ánimo de la compra de un consumible (puro): crece con el ansia y cae con el precio creído. */
export function cravingBuyMood(
  craving: number,
  pricePerKg: number | undefined,
  o: BuyCravingOptions,
): number {
  const ref = o.refPrice ?? 10;
  const price = pricePerKg !== undefined && pricePerKg > 0 ? pricePerKg : 0;
  return Math.round(((o.weight * Math.min(1, craving)) / (1 + price / ref)) * 1e6) / 1e6;
}

/** Opt-in de `decide`: sin con quién comprar, el ansia empuja a salir a recolectar la planta con sustancia. */
export interface GatherCravingOptions {
  /** Ansia mínima (0-1) para que recolectar entre como candidata. */
  readonly minCraving: number;
  /** Peso del empuje con el ansia al máximo. */
  readonly weight: number;
}

/** Empuje de ánimo de recolectar lo que se consume (puro): crece con el ansia, sin precio. */
export function cravingGatherMood(craving: number, o: GatherCravingOptions): number {
  return Math.round(o.weight * Math.min(1, craving) * 1e6) / 1e6;
}

/** Opt-in de `decide`: sin comercio ni planta, el ansia empuja a pedirle la sustancia a un conocido que se cree que la tiene. */
export interface BorrowCravingOptions {
  /** Ansia mínima (0-1) para que pedir prestado entre como candidata. */
  readonly minCraving: number;
  /** Peso del empuje con el ansia al máximo, a plena confianza en el rumor. */
  readonly weight: number;
  /**
   * Opt-in: si cree al prestamista en otro hex (creencia de ubicación, no verdad), `move` hacia el
   * lugar de ese hex entra como candidata con el ánimo del pedido por este factor (0-1). Apagado,
   * solo pide a quien ya tiene delante.
   */
  readonly approach?: number;
}

/** A quién pedirle qué (puro): `lender` es el id como texto; `name` el bien tal como lo nombra el catálogo. */
export interface BorrowAsk {
  readonly lender: string;
  readonly name: string;
  /** 0-1: cuánto cree el rumor. */
  readonly confidence: number;
}

/**
 * Pedidos posibles de una sustancia (puro): ansia alta, sin existencias, y un rumor `attr` `has`
 * de que `lender` tiene ese bien (lo que CREE, no lo que hay). Sin repetir; orden por bien y persona.
 */
export function cravingBorrowAsks(
  craving: number,
  wants: readonly { readonly name: string; readonly have: number }[],
  rumors: readonly { readonly rumor: MoldRumor; readonly confidence: number }[],
  known: ReadonlySet<string>,
  o: BorrowCravingOptions,
): BorrowAsk[] {
  if (craving < o.minCraving) return [];
  const names = new Set(wants.filter((w) => w.have < 1).map((w) => w.name));
  const best = new Map<string, BorrowAsk>();
  for (const { rumor: r, confidence } of rumors) {
    if (r.mold !== "attr" || r.attr !== "has" || typeof r.value !== "string") continue;
    if (!names.has(r.value) || !known.has(r.about)) continue;
    const key = `${r.value}|${r.about}`;
    const prev = best.get(key);
    if (!prev || confidence > prev.confidence) {
      best.set(key, { lender: r.about, name: r.value, confidence });
    }
  }
  const out = [...best.values()];
  return out.sort((a, b) =>
    a.name === b.name
      ? a.lender < b.lender
        ? -1
        : a.lender > b.lender
          ? 1
          : 0
      : a.name < b.name
        ? -1
        : 1,
  );
}

/** Empuje de ánimo de pedir prestado (puro): crece con el ansia y con la confianza en el rumor (0-1). */
export function cravingBorrowMood(
  craving: number,
  confidence: number,
  o: BorrowCravingOptions,
): number {
  const c = Math.min(1, Math.max(0, confidence));
  return Math.round(o.weight * Math.min(1, craving) * c * 1e6) / 1e6;
}

/**
 * Ir hacia el prestamista (puro): por cada pedido con `lender` creído en otro hex que `here` y un
 * lugar que lo contenga (`placeAt`), la candidata `move` hacia ese lugar con su ánimo. Sin
 * `approach`, sin creencia de ubicación o ya en el mismo hex, nada.
 */
export function cravingApproachMoves(
  asks: readonly BorrowAsk[],
  believedHex: (lender: string) => number | undefined,
  here: number,
  placeAt: (hex: number) => string | undefined,
  craving: number,
  o: BorrowCravingOptions,
): { readonly id: string; readonly place: string; readonly mood: number }[] {
  const k = o.approach;
  if (k === undefined || k <= 0) return [];
  const out: { id: string; place: string; mood: number }[] = [];
  for (const ask of asks) {
    const hex = believedHex(ask.lender);
    if (hex === undefined || hex === here) continue;
    const place = placeAt(hex);
    if (place === undefined) continue;
    out.push({
      id: `move:${place}+toward:${ask.lender}`,
      place,
      mood: Math.round(cravingBorrowMood(craving, ask.confidence, o) * Math.min(1, k) * 1e6) / 1e6,
    });
  }
  return out;
}

/**
 * Tomar una dosis ahora (verbo `consume`): suma la dosis al estado de la persona y, si la
 * sustancia no existía, la crea como entidad con su evento. Lo demás (absorber, metabolizar,
 * dañar) lo sigue haciendo `life.substances`. `eventIndex` es el lugar que tendrá el evento
 * `body.substance_introduced` en la lista final de eventos del paso.
 */
export function consumeDose(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  c: ConsumableDef,
  ctx: Pick<ProcessContext, "now" | "newId">,
  place: PlaceRef,
  eventIndex: number,
  learn?: { readonly ctx: CueContext; readonly clock: PlanetClock },
): { readonly changes: StateChange[]; readonly events: EventDraft[] } {
  const prev = truth.get(PERSON_SUBSTANCE, who as never)?.held ?? [];
  const cur = prev.find((h) => h.substance === c.def.id)?.state ?? CLEAN;
  const rows: HeldSubstance[] = [
    ...prev.filter((h) => h.substance !== c.def.id),
    { substance: c.def.id, state: takeDose(c.def, cur, c.route, c.amount) },
  ].sort((a, b) => (a.substance < b.substance ? -1 : 1));
  const now = ctx.now;
  const cues = learn
    ? learnCues(
        truth.get(PERSON_SUBSTANCE, who as never)?.cues ?? [],
        c.def.id,
        learn.ctx,
        now,
        cueHalfLife(learn.clock),
      )
    : (truth.get(PERSON_SUBSTANCE, who as never)?.cues ?? []);
  const changes: StateChange[] = [
    setComponent(PERSON_SUBSTANCE, who as never, {
      held: rows,
      at: now,
      ...(cues.length > 0 ? { cues } : {}),
    }),
  ];
  const events: EventDraft[] = [];
  const known = truth.ids(SUBSTANCE).some((id) => truth.get(SUBSTANCE, id)?.def.id === c.def.id);
  if (!known) {
    events.push({
      kind: "body.substance_introduced",
      actors: [who],
      place,
      data: { substance: c.def.id, source: `consume:${c.good}`, route: c.route },
      emissions: {},
      causes: [{ kind: "state", entity: who, key: "body.substance" }],
    });
    const sid = ctx.newId("substance");
    changes.push(
      createEntity(sid, draftEvent(eventIndex), now),
      setComponent(SUBSTANCE, sid, { def: c.def, source: `consume:${c.good}` }),
    );
  }
  return { changes, events };
}

/** Una dosis explícita: quién la toma, cuándo, por qué vía y qué la trajo. */
export interface SubstanceDose {
  readonly def: SubstanceDef;
  readonly who: AgentId;
  readonly at: Tick;
  readonly route: SubstanceRoute;
  readonly amount: number;
  /** Lo que pasó, en palabras (queda en el evento y en la sustancia). */
  readonly source: string;
  /** Evento que la causó (el tratamiento, si fue un remedio): causa del `body.substance_introduced`. */
  readonly cause?: string;
}

export interface SubstancesOptions {
  readonly clock: PlanetClock;
  readonly doses?: readonly SubstanceDose[];
  /** Opt-in: los remedios con dosis real (`TREATMENT.dose`) se aplican como dosis, con el tratamiento como causa. */
  readonly treatmentDoses?: boolean;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Por debajo de esto no queda nada que guardar. */
const TRACE = 0.01;

function isSpent(s: SubstanceState): boolean {
  return (
    s.blood === 0 &&
    s.damage < TRACE &&
    s.tolerance < TRACE &&
    s.dependence < TRACE &&
    Object.keys(s.depot).length === 0
  );
}

export function substancesProcess(o: SubstancesOptions): ProcessDef {
  const tph = o.clock.day / 24;
  return {
    id: SUBSTANCES_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [
      PERSON.name,
      ENTITY.name,
      BODY_STATE.name,
      SUBSTANCE.name,
      PERSON_SUBSTANCE.name,
      ...(o.treatmentDoses ? [TREATMENT.name] : []),
    ],
    writes: [SUBSTANCE.name, PERSON_SUBSTANCE.name, ENTITY.name],
    run(ctx) {
      const window = Math.max(tph, Math.min(ctx.window, o.clock.day));
      const from = ctx.now - window;
      const dosing = (o.doses ?? []).filter((d) => d.at > from && d.at <= ctx.now);
      // El tratamiento lo escribe `life.medicine` en la misma fase: se ve al día siguiente, así que
      // se toman los dados en [from, now) y la dosis entra en la primera hora de la ventana.
      if (o.treatmentDoses) {
        for (const id of ctx.truth.ids(TREATMENT)) {
          for (const t of ctx.truth.get(TREATMENT, id)?.treatments ?? []) {
            if (!t.dose || t.givenAt < from || t.givenAt >= ctx.now) continue;
            dosing.push({
              def: t.dose.def,
              who: id as AgentId,
              at: from + 1,
              route: t.dose.route,
              amount: t.dose.amount,
              source: `remedy:${t.remedy ?? "?"}`,
              cause: t.cause,
            });
          }
        }
      }
      const holders = new Set<string>(ctx.truth.ids(PERSON_SUBSTANCE));
      for (const d of dosing) holders.add(d.who);
      if (holders.size === 0) return {};

      const known = new Map<string, SubstanceDef>();
      for (const id of ctx.truth.ids(SUBSTANCE)) {
        const rec = ctx.truth.get(SUBSTANCE, id);
        if (rec) known.set(rec.def.id, rec.def);
      }
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const hours = Math.max(1, Math.round(window / tph));
      for (const pid of [...holders].sort()) {
        const base = ctx.truth.get(ENTITY, pid as never);
        const body = ctx.truth.get(BODY_STATE, pid as never);
        if (!base || !body || base.endedAt !== undefined || body.death) continue;
        const agent = pid as AgentId;
        const mine = dosing.filter((d) => d.who === pid);
        const held = new Map<string, SubstanceState>();
        const defs = new Map<string, SubstanceDef>();
        for (const h of ctx.truth.get(PERSON_SUBSTANCE, pid as never)?.held ?? []) {
          held.set(h.substance, h.state);
          const def = known.get(h.substance);
          if (def) defs.set(h.substance, def);
        }
        for (const d of mine) defs.set(d.def.id, known.get(d.def.id) ?? d.def);
        let died = false;
        for (let k = 0; k < hours && !died; k++) {
          const before = from + k * tph;
          const t = before + tph;
          for (const d of mine) {
            if (d.at > before && d.at <= t) {
              const def = defs.get(d.def.id) ?? d.def;
              held.set(d.def.id, takeDose(def, held.get(d.def.id) ?? CLEAN, d.route, d.amount));
            }
          }
          for (const [sid, st] of held) {
            const def = defs.get(sid);
            if (!def) continue;
            const next = stepSubstance(def, st, 1);
            held.set(sid, next);
            if (substanceDeath(next)) died = true;
          }
        }
        // La sustancia nace como entidad con origen la primera vez que alguien la toma.
        for (const d of mine) {
          if (known.has(d.def.id)) continue;
          known.set(d.def.id, d.def);
          const k = events.length;
          const sid = ctx.newId("substance");
          events.push({
            kind: "body.substance_introduced",
            actors: [d.who],
            place: o.placeOf(ctx.truth, d.who),
            data: { substance: d.def.id, source: d.source, route: d.route },
            emissions: {},
            causes: d.cause
              ? [{ kind: "event", event: d.cause as never }]
              : [{ kind: "state", entity: d.who, key: "body.substance" }],
          });
          changes.push(
            createEntity(sid, draftEvent(k), ctx.now),
            setComponent(SUBSTANCE, sid, { def: d.def, source: d.source }),
          );
        }
        const rows: HeldSubstance[] = [...held]
          .filter(([, s]) => !isSpent(s))
          .map(([substance, state]) => ({ substance, state }));
        // Las señales aprendidas (opt-in) pasan tal cual, menos las ya olvidadas.
        const cues = pruneCues(
          ctx.truth.get(PERSON_SUBSTANCE, pid as never)?.cues ?? [],
          ctx.now,
          cueHalfLife(o.clock),
        );
        const withCues = (held: HeldSubstance[]) => ({
          held,
          at: ctx.now,
          ...(cues.length > 0 ? { cues } : {}),
        });
        if (died) {
          const kd = events.length;
          events.push({
            kind: "body.died",
            actors: [agent],
            place: o.placeOf(ctx.truth, agent),
            data: { cause: "poison", substances: [...held.keys()] },
            emissions: { sight: 0.6, sound: 0.2 },
            causes: [{ kind: "state", entity: agent, key: "body.substance" }],
          });
          changes.push(
            endEntity(base, draftEvent(kd), ctx.now),
            setComponent(PERSON_SUBSTANCE, pid as never, withCues(rows)),
          );
        } else if (rows.length > 0 || cues.length > 0) {
          changes.push(setComponent(PERSON_SUBSTANCE, pid as never, withCues(rows)));
        } else if (ctx.truth.get(PERSON_SUBSTANCE, pid as never)) {
          changes.push({ op: "delete", table: PERSON_SUBSTANCE.name, id: pid as never });
        }
      }
      return changes.length > 0 || events.length > 0 ? { changes, events } : {};
    },
  };
}
