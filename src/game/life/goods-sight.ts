// Los bienes que el personaje tiene a la vista para agarrar (play-refs-objects-goods): los lotes no
// son entidades, así que «la olla» o «el pan de la mesa» se buscan por nombre entre las unidades
// del ledger que puede ver. Si lo que nombra no está, se lo dice antes de jugar el turno («No ves
// ninguna olla acá.»), en vez de que la toma se lleve otra cosa. Solo lee: no cambia la verdad.

import { type HolderRef, holderAccount, type LedgerUnit } from "../../core/index.ts";
import {
  goodUnit,
  LOCATION,
  PERSON,
  PLACE,
  type PlanNode,
  placeAt,
  placeRefOf,
  refTokens,
} from "../../sim/index.ts";
import type { LifeWorld } from "./world.ts";

/** Una unidad que se ve: de dónde (`place`, suelta en el lugar; `home`, la despensa de su casa). */
export interface GoodInSight {
  readonly unit: LedgerUnit;
  readonly amount: number;
  readonly where: "place" | "home";
}

/** Lo que se agarra sin nombrar un bien: «agarro algo», «tomo lo que haya», «un puñado». */
const GENERIC = new Set(
  [
    "algo",
    "cosa",
    "cosas",
    "eso",
    "esto",
    "aquello",
    "todo",
    "haya",
    "hay",
    "poco",
    "puñado",
    "montón",
    "resto",
    "demás",
    "suelo",
    "piso",
    "aca",
    "aqui",
    "ahi",
  ].flatMap(refTokens),
);

/** Los bienes a la vista: lo suelto en el lugar donde está y, en su casa, la despensa. */
export function goodsInSight(w: LifeWorld): GoodInSight[] {
  const at = w.truth.get(LOCATION, w.player);
  if (!at) return [];
  const places = w.truth.ids(PLACE).flatMap((id) => {
    const place = w.truth.get(PLACE, id);
    return place ? [{ id, place }] : [];
  });
  const out: GoodInSight[] = [];
  const add = (holder: HolderRef, where: GoodInSight["where"]) => {
    for (const h of w.ledger.holdings(holderAccount(holder))) {
      if (h.amount > 0) out.push({ unit: h.unit, amount: h.amount, where });
    }
  };
  add(placeRefOf(w.map, placeAt(places, at.hex)), "place");
  const household = w.truth.get(PERSON, w.player)?.household;
  const node = at.space === undefined ? undefined : w.spaces.spaces.find((s) => s.key === at.space);
  if (household !== undefined && node?.household === household && node.indoor) {
    add(household as unknown as HolderRef, "home");
  }
  return out;
}

/** Las palabras con que se nombra una unidad: su id y su nombre en el contenido. */
function unitWords(w: LifeWorld, unit: LedgerUnit): string[] {
  const name = w.goods.find((g) => goodUnit(g) === unit)?.name;
  const id = refTokens(unit.replace(/^[a-z]+:/, "").replace(/_/g, " "));
  return name === undefined ? id : [...id, ...refTokens(name)];
}

/** Lo que pide agarrar por nombre cada `take` del plan (sin `from`: de una persona es otra cosa). */
function takenTexts(node: PlanNode): string[] {
  switch (node.kind) {
    case "do": {
      if (node.verb !== "take" || node.args.some((a) => a.role === "from")) return [];
      const what = node.args.find((a) => a.role === "what");
      return what !== undefined && "text" in what ? [what.text] : [];
    }
    case "seq":
      return node.steps.flatMap(takenTexts);
    case "until":
    case "repeat":
      return takenTexts(node.body);
    case "if":
      return [...takenTexts(node.then), ...(node.else ? takenTexts(node.else) : [])];
    default:
      return [];
  }
}

/** «La olla» → «ninguna olla»; «el pan» → «ningún pan»; «ollas» → «ollas». */
function noneOf(text: string): string {
  const m = /^\s*(el|la|los|las|un|una|unos|unas)\s+(.+?)\s*$/iu.exec(text);
  if (!m) return text.trim();
  const article = (m[1] as string).toLowerCase();
  const rest = m[2] as string;
  if (article === "la" || article === "una") return `ninguna ${rest}`;
  if (article === "el" || article === "un") return `ningún ${rest}`;
  return rest;
}

/**
 * Si el plan pide agarrar algo por nombre que no está a la vista, lo que se le dice al jugador
 * («No ves ninguna olla acá.»); `undefined` si todo lo nombrado está o no nombra nada.
 */
export function missingGoodsNote(w: LifeWorld, root: PlanNode): string | undefined {
  const texts = takenTexts(root);
  if (texts.length === 0) return undefined;
  const sight = goodsInSight(w);
  const words = new Set(sight.flatMap((g) => unitWords(w, g.unit)));
  for (const text of texts) {
    const said = refTokens(text).filter((t) => !GENERIC.has(t));
    if (said.length === 0 || said.some((t) => words.has(t))) continue;
    return `No ves ${noneOf(text)} acá.`;
  }
  return undefined;
}
