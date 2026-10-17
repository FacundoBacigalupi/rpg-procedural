// Núcleo opt-in: un producto conserva las unidades materiales de sus insumos en una cuenta
// exclusiva. Cambia la forma del material, no aparece otra masa por una fuente externa.
import {
  compareStrings,
  type EventId,
  isExternal,
  isId,
  type Ledger,
  type LedgerAccount,
  type LedgerUnit,
  type LotId,
  type Posting,
  type Tick,
  z,
} from "../../core/index.ts";
import { offeringLot } from "../economy/index.ts";

/** Recetas del llamador: no registra contenido ni altera el catálogo de vidas existentes. */
export const CultRecipe = z
  .strictObject({
    id: z.string().min(1),
    product: z.enum(["incense", "offering_paper", "candle", "tablet"]),
    inputs: z
      .array(
        z.strictObject({
          material: z.string().min(1),
          grams: z.number().int().positive().safe(),
        }),
      )
      .min(1),
  })
  .superRefine((recipe, ctx) => {
    if (new Set(recipe.inputs.map((input) => input.material)).size !== recipe.inputs.length) {
      ctx.addIssue({ code: "custom", message: "material repetido", path: ["inputs"] });
    }
  });
export type CultRecipe = z.infer<typeof CultRecipe>;

export interface CultMaterial {
  readonly id: LotId;
  readonly material: string;
  readonly unit: LedgerUnit;
  readonly from: LedgerAccount;
  readonly originEventId: EventId;
}

export interface CultLot {
  readonly id: LotId;
  readonly recipe: string;
  readonly product: CultRecipe["product"];
  readonly account: LedgerAccount;
  readonly originEventId: EventId;
  readonly materials: readonly (CultMaterial & { readonly grams: number })[];
}

/** Plan completo o error; el llamador aplica el asiento atómicamente y registra el lote. */
export function craftCultLot(
  recipe: CultRecipe,
  materials: readonly CultMaterial[],
  id: LotId,
  account: LedgerAccount,
  eventId: EventId,
  tick: Tick,
  ledger: Pick<Ledger, "holdings" | "preview">,
): { readonly lot: CultLot; readonly posting: Posting } {
  validateOrigin(id, eventId, tick);
  const parsed = CultRecipe.parse(recipe);
  if (isExternal(account) || ledger.holdings(account).length > 0) {
    throw new TypeError("el producto requiere una cuenta interna vacía y exclusiva");
  }
  if (
    materials.length !== parsed.inputs.length ||
    new Set(materials.map((m) => m.id)).size !== materials.length
  ) {
    throw new TypeError("insumos incompletos o lotes repetidos");
  }
  const used = [...parsed.inputs]
    .sort((a, b) => compareStrings(a.material, b.material))
    .map((input) => {
      const matches = materials.filter((m) => m.material === input.material);
      const material = matches[0];
      if (
        matches.length !== 1 ||
        !material ||
        !isId("event", material.originEventId) ||
        !isId("lot", material.id) ||
        !material.unit.startsWith("good:") ||
        material.id === id ||
        material.from === account ||
        isExternal(material.from)
      ) {
        throw new TypeError("insumo sin origen o sin cuenta interna propia");
      }
      return { ...material, grams: input.grams };
    });
  const posting: Posting = {
    tick,
    eventId,
    transfers: used.map((m) => ({ unit: m.unit, from: m.from, to: account, amount: m.grams })),
  };
  ledger.preview(posting);
  return {
    lot: {
      id,
      recipe: parsed.id,
      product: parsed.product,
      account,
      originEventId: eventId,
      materials: used,
    },
    posting,
  };
}

/** Quema toda la materia del producto; ceniza y humo van al sumidero ya declarado por el llamador. */
export function burnCultLot(
  lot: CultLot,
  ash: LedgerAccount,
  eventId: EventId,
  tick: Tick,
  ledger: Pick<Ledger, "preview">,
): Posting {
  validateOrigin(lot.id, eventId, tick);
  if (
    !isId("event", lot.originEventId) ||
    isExternal(lot.account) ||
    lot.materials.length === 0 ||
    new Set(lot.materials.map((m) => m.id)).size !== lot.materials.length ||
    lot.materials.some(
      (m) =>
        !isId("lot", m.id) ||
        !isId("event", m.originEventId) ||
        !m.unit.startsWith("good:") ||
        !Number.isSafeInteger(m.grams) ||
        m.grams <= 0,
    )
  ) {
    throw new TypeError("lote de culto inválido");
  }
  if (!isExternal(ash)) throw new TypeError("la ceniza requiere un sumidero externo");
  const posting: Posting = {
    tick,
    eventId,
    transfers: lot.materials.flatMap(
      (m) =>
        offeringLot(
          m.unit,
          m.grams,
          { burned: 1 },
          {
            from: lot.account,
            ash,
            buried: lot.account,
          },
        ).transfers,
    ),
  };
  ledger.preview(posting);
  return posting;
}

function validateOrigin(id: LotId, eventId: EventId, tick: Tick): void {
  if (!isId("lot", id) || !isId("event", eventId) || !Number.isSafeInteger(tick) || tick < 0) {
    throw new TypeError("origen o tick inválido para el lote de culto");
  }
}
