// Toxicidad de lo ingerido con `Essence` cableada a la vida (body-health §9, cultivation): tomar
// una píldora o comida espiritual con pureza escribe `RESIDUE` (la parte impura se queda en el
// cuerpo), `life.residue` la purga cada día y, si se pide, tira la desviación de cultivo con RNG
// por clave; `overload` de lo que come un mortal de más sale como fiebre, meridianos quemados o
// muerte con causa. Opt-in: sin `residue` en las opciones no hay filas, ni RNG, ni eventos. La
// eficiencia de cultivo (`cultivationEfficiencyOf`) la lee quien cultive.

import {
  type AgentId,
  type CauseRef,
  externalAccount,
  type HolderRef,
  holderAccount,
  type LedgerConfig,
  ledgerUnit,
  type PlaceRef,
  type PlanetClock,
} from "../../core/index.ts";
import {
  BODY_STATE,
  cultivationEfficiency,
  deviationRisk,
  draftEvent,
  ENTITY,
  type EventDraft,
  NATURAL_PURGE,
  type OverloadBody,
  type OverloadResult,
  overload,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  type PurgeMethod,
  RESIDUE,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  splitByPurity,
  stepResidue,
} from "../../sim/index.ts";

/** Unidad de `Essence` del ledger (en milésimas: el residuo es un decimal, el ledger va en enteros). */
export const ESSENCE_UNIT = "essence";
export const ESSENCE_SCALE = 1000;
/** Fuente: la `Essence` de lo ingerido que el cuerpo retiene como residuo. */
export const ESSENCE_INTAKE = "essence-intake";
/** Sumideros: el residuo purgado y lo que el desvío descarga (al entorno, no se pierde). */
export const RESIDUE_PURGED = "residue-purged";
export const DEVIATION_DISCHARGE = "deviation-discharge";

/** Fuentes y sumideros de `Essence` que la vida declara cuando el residuo lleva ledger (opt-in). */
export function residueExternals(cfg: ResidueConfig | undefined): LedgerConfig["externals"] {
  if (!cfg?.ledger) return {};
  return {
    [ESSENCE_INTAKE]: [ESSENCE_UNIT],
    [RESIDUE_PURGED]: [ESSENCE_UNIT],
    [DEVIATION_DISCHARGE]: [ESSENCE_UNIT],
  };
}

export const RESIDUE_PROCESS = "life.residue";

/** Cuerpo por defecto cuando la configuración no lo da: lo que soporta y su afinidad. */
export const DEFAULT_RESIDUE_BODY: OverloadBody = { capacity: 10, affinity: 0.3 };

export interface ResidueConfig {
  /** Capacidad y afinidad de cada cuerpo (cultivo, constitución); por defecto `DEFAULT_RESIDUE_BODY`. */
  readonly bodyOf?: (truth: ReadonlyWorldTruth, who: AgentId) => OverloadBody;
  /** Cómo se purga (por defecto `NATURAL_PURGE`). */
  readonly purge?: PurgeMethod;
  /** Sobrecarga de quien come de más (fiebre, meridianos quemados, muerte). Apagado: sin efecto. */
  readonly overload?: boolean;
  /** Tira la desviación de cultivo cada día con el riesgo que da la carga (RNG por clave). */
  readonly deviation?: boolean;
  /** Estabilidad del fundamento (0-1) de cada uno; por defecto 0,5. */
  readonly stabilityOf?: (truth: ReadonlyWorldTruth, who: AgentId) => number;
  /**
   * Conservación: el residuo vive como `Essence` en la cuenta de quien lo carga (entra por la
   * fuente `essence-intake` al ingerir; sale al sumidero `residue-purged` al purgar o morir y a
   * `deviation-discharge` por el desvío). Apagado: el residuo es solo un número, sin asientos.
   */
  readonly ledger?: boolean;
}

export const residueBodyOf = (
  cfg: ResidueConfig,
  truth: ReadonlyWorldTruth,
  who: AgentId,
): OverloadBody => cfg.bodyOf?.(truth, who) ?? DEFAULT_RESIDUE_BODY;

/** Multiplicador (0-1] de absorber y cultivar por el residuo de `who`; sin fila, 1. */
export function cultivationEfficiencyOf(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  cfg: ResidueConfig = {},
): number {
  const row = truth.get(RESIDUE, who as never);
  return row ? cultivationEfficiency(row.load, residueBodyOf(cfg, truth, who).capacity) : 1;
}

export interface EssenceIntake {
  readonly changes: StateChange[];
  readonly events: EventDraft[];
  /** La sobrecarga (solo con `overload` encendido); quien llama aplica heridas o muerte. */
  readonly overload: OverloadResult | undefined;
  /** Asientos de conservación (solo con `ledger`): la `Essence` retenida entra al cuerpo. */
  readonly postings: PostingDraft[];
}

/**
 * Una ingesta de `essence` con `purity` (0-1): suma el residuo a `RESIDUE` y, con `overload`,
 * evalúa la sobrecarga del cuerpo con lo útil. Si hay sobrecarga deja el evento `body.overload`
 * con `cause`. Sin esencia, nada.
 */
export function takeEssence(
  truth: ReadonlyWorldTruth,
  who: AgentId,
  intake: { readonly essence: number; readonly purity?: number | undefined; readonly good: string },
  cfg: ResidueConfig,
  now: number,
  place: PlaceRef,
  cause: CauseRef,
): EssenceIntake {
  if (!(intake.essence > 0)) return { changes: [], events: [], overload: undefined, postings: [] };
  const split = splitByPurity(intake.essence, intake.purity ?? 1);
  const body = residueBodyOf(cfg, truth, who);
  const changes: StateChange[] = [];
  const events: EventDraft[] = [];
  const postings: PostingDraft[] = [];
  let res: OverloadResult | undefined;
  if (cfg.overload === true) {
    res = overload(body, split.useful);
    if (res.stage === "none") res = undefined;
  }
  if (split.residue > 0) {
    const had = truth.get(RESIDUE, who as never);
    changes.push(
      setComponent(RESIDUE, who as never, {
        ...(had ?? {}),
        load: (had?.load ?? 0) + split.residue,
        at: now,
      }),
    );
    const milli = Math.round(split.residue * ESSENCE_SCALE);
    if (cfg.ledger === true && milli > 0 && cause.kind === "event") {
      postings.push({
        event: cause.event,
        transfers: [
          {
            unit: ledgerUnit(ESSENCE_UNIT),
            from: externalAccount(ESSENCE_INTAKE),
            to: holderAccount(who as unknown as HolderRef),
            amount: milli,
          },
        ],
      });
    }
  }
  if (res) {
    events.push({
      kind: "body.overload",
      actors: [who],
      place,
      data: {
        stage: res.stage,
        good: intake.good,
        intake: split.useful,
        absorbed: res.absorbed,
        dissipated: res.dissipated,
        fever: res.fever,
        meridianDamage: res.meridianDamage,
        awakens: res.awakens,
      },
      emissions: { sight: 0.3 },
      causes: [cause],
    });
  }
  return { changes, events, overload: res, postings };
}

export interface ResidueProcessOptions extends ResidueConfig {
  readonly clock: PlanetClock;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

const MIN_LOAD = 1e-6;
const MAX_DAYS = 400;

export function residueProcess(o: ResidueProcessOptions): ProcessDef {
  const method = o.purge ?? NATURAL_PURGE;
  return {
    id: RESIDUE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, ENTITY.name, BODY_STATE.name, RESIDUE.name],
    writes: [RESIDUE.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const postings: PostingDraft[] = [];
      const essence = ledgerUnit(ESSENCE_UNIT);
      // Lleva la cuenta del cuerpo a `target` milésimas: lo que sobra va al sumidero con su evento.
      const settle = (
        who: AgentId,
        target: number,
        discharged: number,
        reason: "purge" | "death",
        at: number,
        day: number,
        deviationEvent: number | undefined,
      ) => {
        if (o.ledger !== true || !ctx.ledger) return;
        const account = holderAccount(who as unknown as HolderRef);
        const diff = ctx.ledger.balance(account, essence) - target;
        if (diff <= 0) return;
        const dev = Math.min(diff, Math.round(discharged * ESSENCE_SCALE));
        const purged = diff - dev;
        if (dev > 0 && deviationEvent !== undefined) {
          postings.push({
            event: draftEvent(deviationEvent),
            transfers: [
              {
                unit: essence,
                from: account,
                to: externalAccount(DEVIATION_DISCHARGE),
                amount: dev,
              },
            ],
          });
        }
        const rest = deviationEvent === undefined ? diff : purged;
        if (rest > 0) {
          const k = events.length;
          events.push({
            kind: "body.purged",
            actors: [who],
            place: o.placeOf(ctx.truth, who),
            data: { amount: rest / ESSENCE_SCALE, reason, day, at },
            emissions: {},
            causes: [{ kind: "state", entity: who, key: "body.residue" }],
          });
          postings.push({
            event: draftEvent(k),
            transfers: [
              {
                unit: essence,
                from: account,
                to: externalAccount(RESIDUE_PURGED),
                amount: rest,
              },
            ],
          });
        }
      };
      const days = Math.max(1, Math.min(MAX_DAYS, Math.round(ctx.window / o.clock.day)));
      const today = Math.floor(ctx.now / o.clock.day);
      for (const id of ctx.truth.ids(RESIDUE)) {
        const had = ctx.truth.get(RESIDUE, id);
        const base = ctx.truth.get(ENTITY, id);
        const body = ctx.truth.get(BODY_STATE, id);
        if (!had) continue;
        if (!base || base.endedAt !== undefined || body?.death) {
          changes.push({ op: "delete", table: RESIDUE.name, id });
          settle(id as AgentId, 0, 0, "death", ctx.now, today, undefined);
          continue;
        }
        const who = id as AgentId;
        const capacity = residueBodyOf(o, ctx.truth, who).capacity;
        let load = had.load;
        let deviations = had.deviations ?? 0;
        let lastDeviation = had.lastDeviation;
        let discharged = 0;
        let firstDeviation: number | undefined;
        for (let d = 0; d < days; d++) {
          load = stepResidue(load, 1, capacity, method).load;
          if (o.deviation !== true) continue;
          const risk = deviationRisk(load, capacity, o.stabilityOf?.(ctx.truth, who) ?? 0.5);
          if (risk <= 0) continue;
          const day = today - (days - 1 - d);
          if (ctx.rng.fork("residue", id as unknown as number, day).float() < risk) {
            if (firstDeviation === undefined) firstDeviation = events.length;
            events.push({
              kind: "cultivation.deviation",
              actors: [who],
              place: o.placeOf(ctx.truth, who),
              data: { load, capacity, risk, day },
              emissions: { sight: 0.2 },
              causes: [{ kind: "state", entity: who, key: "body.residue" }],
            });
            deviations += 1;
            lastDeviation = ctx.now;
            // El desvío descarga la mitad de lo retenido (sin cablear el destino de esa Essence).
            discharged += load / 2;
            load /= 2;
          }
        }
        settle(
          who,
          load > MIN_LOAD ? Math.round(load * ESSENCE_SCALE) : 0,
          discharged,
          "purge",
          ctx.now,
          today,
          firstDeviation,
        );
        if (load > MIN_LOAD) {
          if (load !== had.load || deviations !== (had.deviations ?? 0)) {
            changes.push(
              setComponent(RESIDUE, id, {
                load,
                at: ctx.now,
                ...(deviations > 0 ? { deviations } : {}),
                ...(lastDeviation !== undefined ? { lastDeviation } : {}),
              }),
            );
          }
        } else changes.push({ op: "delete", table: RESIDUE.name, id });
      }
      return changes.length > 0 || events.length > 0
        ? { changes, events, ...(postings.length > 0 ? { postings } : {}) }
        : {};
    },
  };
}
