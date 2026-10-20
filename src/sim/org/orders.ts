// Consejo de aldea 4 (organizations §4-§5): el tesoro y las órdenes. Una decisión aprobada
// (`OrgDecision`, outcome `enacted`) se vuelve una `Order` con efecto acotado: repartir grano en la
// hambruna, asumir parte de una deuda en mora o mediar una disputa. La ejecuta un miembro real, que
// puede no obedecer (brecha de obediencia: quien votó en contra, o a quien la orden le toca el
// bolsillo, cumple menos). El tesoro es una cuenta del ledger (`holderAccount(orgId)`) que solo se
// llena con aportes de los miembros y solo se vacía en órdenes: no aparece nada de la nada.
//
// Puro: sin IO ni ledger. Las cantidades y saldos los mide `life/council.ts`; acá solo reglas.

import type { AgentId, EventId, OrgId, Rng, Tick } from "../../core/index.ts";
import { table } from "../world/index.ts";
import { activeMembers, type Organization } from "./council.ts";
import type { CastVote, IssueOption, OrgDecision } from "./issues.ts";

export type OrderStatus = "pending" | "done" | "refused" | "failed" | "void";

export interface Order {
  readonly id: string;
  readonly org: OrgId;
  readonly decision: string;
  readonly option: IssueOption;
  readonly subject: string;
  /** El miembro que tiene que cumplirla. */
  readonly executor: AgentId;
  readonly issuedAt: Tick;
  /** El evento `org.ordered` que la abrió. */
  readonly issuedEvent: EventId;
  readonly status: OrderStatus;
  readonly closedAt?: Tick;
  /** Por qué no se cumplió (`status` refused/failed/void), o el detalle de lo hecho. */
  readonly note?: string;
  /** Lo que salió del tesoro (en la unidad que sea) al cumplirla. */
  readonly spent?: number;
  readonly unit?: string;
}

export interface OrderBook {
  readonly orders: readonly Order[];
  /** Por préstamo (id), lo que el tesoro ya pagó al acreedor: la presión lo descuenta. */
  readonly assumed: Readonly<Record<string, number>>;
  readonly serial: number;
}

/** Las órdenes de un consejo. Solo la escribe `life.council`. */
export const ORG_ORDERS = table<OrderBook>("org.orders");
export const EMPTY_BOOK: OrderBook = { orders: [], assumed: {}, serial: 0 };

export interface OrderRules {
  /** Días entre la decisión y el intento de cumplirla. */
  readonly executeAfterDays: number;
  /** Probabilidad de cumplir si el ejecutor votó a favor. */
  readonly assentObeys: number;
  /** Probabilidad de cumplir si votó en contra (o no votó). */
  readonly dissentObeys: number;
  /** Cuánto baja la probabilidad si cumplir le cuesta al ejecutor (su hogar es el acreedor). */
  readonly conflictPenalty: number;
  /** Hambruna: gramos de grano que reparte el tesoro al hogar. */
  readonly reliefGrams: number;
  /** Deuda: fracción de lo adeudado que asume el tesoro (lo paga al acreedor). */
  readonly assumeFraction: number;
  /** Disputa: cuánto baja el rencor de cada parte con la mediación (0-1). */
  readonly resentmentDrop: number;
  /** Disputa: gramos de grano de la comida de reconciliación que paga el tesoro (se reparten entre los hogares). */
  readonly feastGrams: number;
  /** Órdenes que se guardan (las más nuevas). */
  readonly keepOrders: number;
}

export const DEFAULT_ORDER_RULES: OrderRules = {
  executeAfterDays: 1,
  assentObeys: 0.97,
  dissentObeys: 0.6,
  conflictPenalty: 0.5,
  reliefGrams: 30000,
  assumeFraction: 0.5,
  resentmentDrop: 0.3,
  feastGrams: 6000,
  keepOrders: 40,
};

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** El miembro que cumple la orden: quien planteó el asunto si sigue en el consejo; si no, el cabeza; si no, el de menor id. */
export function chooseExecutor(org: Organization, d: OrgDecision): AgentId | null {
  const act = activeMembers(org);
  if (act.some((m) => m.agent === d.raisedBy)) return d.raisedBy;
  const head = act.find((m) => m.rank === "head");
  if (head) return head.agent;
  return [...act].map((m) => m.agent).sort()[0] ?? null;
}

/** La orden de una decisión aprobada (null si no se aprobó o no queda a quién encargarla). */
export function orderFrom(
  org: Organization,
  d: OrgDecision,
  id: string,
  at: Tick,
  issuedEvent: EventId,
): Order | null {
  // La defensa aún requiere su contrato de guardia y recursos; una resolución no la ejecuta.
  if (d.outcome !== "enacted" || d.option === "defend") return null;
  const executor = chooseExecutor(org, d);
  if (executor === null) return null;
  return {
    id,
    org: org.id,
    decision: d.id,
    option: d.option,
    subject: d.subject,
    executor,
    issuedAt: at,
    issuedEvent,
    status: "pending",
  };
}

/** Probabilidad de que el ejecutor cumpla: depende de cómo votó y de si cumplir le toca el bolsillo. */
export function obedienceChance(
  vote: CastVote | undefined,
  conflict: boolean,
  rules: OrderRules = DEFAULT_ORDER_RULES,
): number {
  const base = vote?.vote === "for" ? rules.assentObeys : rules.dissentObeys;
  return round6(clamp01(conflict ? base - rules.conflictPenalty : base));
}

/** ¿Cumple? Sorteo sobre el RNG que le pasa el proceso. */
export function obeys(chance: number, rng: Rng): boolean {
  return rng.chance(chance);
}

/** Cuánto puede gastar: lo que pide, tope lo que hay (entero, nunca negativo). */
export function spendable(want: number, balance: number): number {
  return Math.max(0, Math.min(Math.floor(want), Math.floor(balance)));
}

/** Lo adeudado que el tesoro todavía puede asumir de un préstamo: la fracción de lo que falta, entero hacia arriba. */
export function assumeAmount(owed: number, rules: OrderRules): number {
  return Math.max(0, Math.ceil(owed * rules.assumeFraction));
}

export function openOrders(book: OrderBook): readonly Order[] {
  return book.orders.filter((o) => o.status === "pending");
}

export function addOrder(book: OrderBook, o: Order, keep: number): OrderBook {
  return {
    ...book,
    orders: [...book.orders, o].slice(-Math.max(1, keep)),
    serial: book.serial + 1,
  };
}

/** Cierra la orden con su resultado; si pagó una deuda, anota lo asumido. */
export function closeOrder(
  book: OrderBook,
  id: string,
  status: Exclude<OrderStatus, "pending">,
  at: Tick,
  extra: {
    note?: string;
    spent?: number;
    unit?: string;
    loan?: string;
  } = {},
): OrderBook {
  const { loan, ...rest } = extra;
  return {
    ...book,
    orders: book.orders.map((o) => (o.id === id ? { ...o, status, closedAt: at, ...rest } : o)),
    assumed:
      loan && extra.spent
        ? { ...book.assumed, [loan]: (book.assumed[loan] ?? 0) + extra.spent }
        : book.assumed,
  };
}

/** Lo que tiene que cumplir todo libro de órdenes; devuelve las violaciones. */
export function orderViolations(org: Organization, book: OrderBook): readonly string[] {
  const out: string[] = [];
  const everMember = new Set(org.members.map((m) => m.agent as string));
  const ids = new Set<string>();
  for (const o of book.orders) {
    if (ids.has(o.id)) out.push(`${org.id}: orden ${o.id} repetida`);
    ids.add(o.id);
    if (o.org !== org.id) out.push(`${org.id}: la orden ${o.id} es de otra organización`);
    if (!everMember.has(o.executor))
      out.push(`${org.id}: ${o.id} la cumple ${o.executor}, que no es miembro`);
    if (!o.issuedEvent) out.push(`${org.id}: orden ${o.id} sin evento`);
    if (o.status === "pending" && o.closedAt !== undefined)
      out.push(`${org.id}: ${o.id} pendiente y cerrada`);
    if (o.status !== "pending" && o.closedAt === undefined)
      out.push(`${org.id}: ${o.id} ${o.status} sin cierre`);
    if (o.status === "done" && (o.spent ?? 0) < 0) out.push(`${org.id}: ${o.id} gasto negativo`);
    if (o.status !== "done" && (o.spent ?? 0) !== 0 && o.spent !== undefined)
      out.push(`${org.id}: ${o.id} no se cumplió y gastó`);
  }
  for (const [loan, n] of Object.entries(book.assumed))
    if (!(n >= 0)) out.push(`${org.id}: asumido negativo en ${loan}`);
  return out;
}
