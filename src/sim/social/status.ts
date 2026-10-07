// El estatus de aldea (social-structure §1, §2, §3, §4 en su forma mínima, Fase 1). Una cultura
// declara sus estatus en `content/statuses/`; quién tiene cuál es un hecho social de la aldea
// (`StatusHolding`, con su causa), no una propiedad de la persona: lo reconoce una comunidad. En
// la aldea hay tres: el terrateniente, los campesinos libres y los sirvientes, que dependen de la
// casa del terrateniente. Lo visible (la ropa) sale del estatus y es lo único que un extraño lee
// por la vista; la deferencia se calcula del rango de cada parte y mueve el regateo.
//
// Todavía no hay creencias sobre la posición ajena con errores, etiqueta ni ofensas que cuestan
// cara (Fase 2), ni el estatus como compromiso con ejecutores (Fase 3): hoy la aldea entera
// reconoce a todos, y el sirviente lo es por costumbre de su casa.

import {
  contentId,
  defineContent,
  type EventId,
  type HouseholdId,
  type SettlementId,
  type Tick,
  z,
} from "../../core/index.ts";
import { table } from "../world/index.ts";

export const ATTIRES = ["fine", "plain", "worn"] as const;
/** Cómo se ve la ropa de alguien: lo que se lee de lejos de su posición (§3). */
export type Attire = (typeof ATTIRES)[number];

export const STATUS_ROLES = ["holder", "common", "dependent"] as const;
/** Qué lugar ocupa el estatus en la aldea: el de arriba, el de la mayoría, el que depende. */
export type StatusRole = (typeof STATUS_ROLES)[number];

export const StatusDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  culture: contentId,
  role: z.enum(STATUS_ROLES),
  /** Orden ritual dentro de la cultura (§2): más alto, más arriba. */
  rank: z.number().int().min(0),
  /** Cuánto del patrimonio medio de arranque tiene su casa (despensa y monedas). */
  wealth: z.number().positive(),
  /** La marca visible: cómo viste (§3). */
  attire: z.enum(ATTIRES),
});
export type StatusDef = z.infer<typeof StatusDef>;

export const STATUSES = defineContent("statuses", StatusDef);

/** Un estatus que una comunidad reconoce en alguien, con su causa (§2). */
export interface StatusHolding {
  readonly status: string;
  /** `custom`: la costumbre de la aldea al fundarse; el nacimiento y los compromisos llegan después. */
  readonly basis: "custom";
  /** La casa de la que depende, si el estatus es de dependencia. */
  readonly patron: HouseholdId | null;
  readonly recognizedBy: SettlementId;
  readonly since: Tick;
  readonly originEventId: EventId;
}

/** Quién tiene qué estatus: una fila por agente. */
export const STATUS = table<StatusHolding>("social.status");

/** Lo que `assignStatuses` necesita de un hogar. */
export interface HouseholdSeat {
  readonly id: HouseholdId;
  readonly members: number;
  readonly since: Tick;
}

export interface StatusAssignment {
  readonly status: string;
  readonly patron: HouseholdId | null;
}

function pickRole(defs: readonly StatusDef[], role: StatusRole): StatusDef | undefined {
  return defs.filter((d) => d.role === role).sort((a, b) => b.rank - a.rank)[0];
}

/**
 * Quién es quién en una aldea (§12: las estructuras salen de algo): la casa más numerosa (la más
 * vieja si empatan) fue la que más tierra tomó al fundarse y es la del terrateniente; con cuatro
 * casas o más, la más chica le sirve; el resto son libres. Con menos casas no hay jerarquía:
 * todas son comunes. Determinista y sin azar.
 */
export function assignStatuses(
  households: readonly HouseholdSeat[],
  defs: readonly StatusDef[],
): Map<HouseholdId, StatusAssignment> {
  const common = pickRole(defs, "common");
  if (!common) throw new Error("falta un estatus común en la cultura de la aldea");
  const out = new Map<HouseholdId, StatusAssignment>();
  for (const h of households) out.set(h.id, { status: common.id, patron: null });
  const holder = pickRole(defs, "holder");
  const dependent = pickRole(defs, "dependent");
  if (!holder || households.length < 3) return out;

  const bigFirst = [...households].sort(
    (a, b) => b.members - a.members || a.since - b.since || (a.id < b.id ? -1 : 1),
  );
  const top = bigFirst[0] as HouseholdSeat;
  out.set(top.id, { status: holder.id, patron: null });
  if (dependent && households.length >= 4) {
    const last = bigFirst[bigFirst.length - 1] as HouseholdSeat;
    out.set(last.id, { status: dependent.id, patron: top.id });
  }
  return out;
}

/** Cuánto aprieta el rango en el regateo, por escalón de diferencia (calibración abierta). */
export const DEFERENCE_PER_RANK = 0.06;
export const DEFERENCE_MAX = 0.12;

/**
 * La deferencia en el trato (§4): quien se cree por debajo cede un poco y quien se cree por
 * encima aprieta. Devuelve la ventaja a favor de `actor` (-`DEFERENCE_MAX` a `DEFERENCE_MAX`),
 * para sumar a la del regateo. Sin rango de alguno de los dos, no hay deferencia.
 */
export function deferenceEdge(
  actorRank: number | undefined,
  otherRank: number | undefined,
): number {
  if (actorRank === undefined || otherRank === undefined) return 0;
  const raw = (actorRank - otherRank) * DEFERENCE_PER_RANK;
  return Math.max(-DEFERENCE_MAX, Math.min(DEFERENCE_MAX, raw));
}

/** El rango ritual de alguien, si tiene estatus. */
export function rankOf(
  holding: Pick<StatusHolding, "status"> | undefined,
  defs: readonly StatusDef[],
): number | undefined {
  return holding === undefined ? undefined : defs.find((d) => d.id === holding.status)?.rank;
}

/** Cómo viste alguien, si tiene estatus (lo que se ve de su posición). */
export function attireOfAgent(
  holding: Pick<StatusHolding, "status"> | undefined,
  defs: readonly StatusDef[],
): Attire | undefined {
  return holding === undefined ? undefined : defs.find((d) => d.id === holding.status)?.attire;
}

/** El `attire` de un `Look` para quien lo tiene: vacío si no hay estatus. */
export function attireLook(
  holding: Pick<StatusHolding, "status"> | undefined,
  defs: readonly StatusDef[],
): { attire?: Attire } {
  const a = attireOfAgent(holding, defs);
  return a === undefined ? {} : { attire: a };
}

/** Lo que un extraño deduce de la ropa (§3): la posición percibida, sin errores todavía. */
export type Standing = "high" | "common" | "low";

export function standingOf(attire: Attire): Standing {
  return attire === "fine" ? "high" : attire === "worn" ? "low" : "common";
}
