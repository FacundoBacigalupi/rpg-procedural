// Formas de tenencia de una cultura (property §4): cada una es un haz de incidentes con su norma de
// herencia y de venta y su forma de dejar constancia. La aldea tiene tres: propiedad plena,
// uso por arriendo de palabra (quien trabaja tierra ajena) y comunal (pastos y monte de todos).

import { contentId, defineContent, z } from "../../core/index.ts";

export const INCIDENTS = [
  "possess",
  "use",
  "fruits",
  "exclude",
  "alienate",
  "bequeath",
  "pledge",
  "build",
  "graze",
  "gather",
  "pass",
] as const;
export type Incident = (typeof INCIDENTS)[number];

/** Cómo queda constancia: testigos que estuvieron, o la costumbre sin nadie en particular. */
export const RECORD_KINDS = ["witnesses", "custom"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const TenureDef = z.strictObject({
  id: contentId,
  name: z.string().min(1),
  culture: contentId,
  incidents: z.array(z.enum(INCIDENTS)).min(1),
  heritable: z.boolean(),
  alienable: z.boolean(),
  record: z.enum(RECORD_KINDS),
});
export type TenureDef = z.infer<typeof TenureDef>;

export const TENURES = defineContent("tenure", TenureDef);
