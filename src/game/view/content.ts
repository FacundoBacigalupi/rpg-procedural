// Lo que la vista y el narrador leen de `content/llm/` (narration §8, §11): la paleta de ambiente
// (texturas sin consecuencias por lugar, hora y luz, que la sim elige y el LLM puede usar) y las
// plantillas del narrador sin red. Viven en `game` porque leen la escena de `PlayerView`; el
// renderizador de plantillas está en `llm/templates`.

import { type ContentKind, contentId, defineContent, z } from "../../core/index.ts";
import { CONTENT_KINDS, PLACE_KINDS, SPACE_KINDS } from "../../sim/index.ts";
import type { SceneView } from "./view.ts";

const TIMES = ["night", "dawn", "morning", "midday", "afternoon", "dusk"] as const;
const LIGHTS = ["dark", "dim", "bright"] as const;

/** Una textura del lugar: cuándo vale y cómo se dice. */
export const AmbienceEntry = z.strictObject({
  id: contentId,
  when: z.strictObject({
    placeKinds: z.array(z.enum(PLACE_KINDS)).min(1).optional(),
    spaces: z.array(z.enum(SPACE_KINDS)).min(1).optional(),
    indoor: z.boolean().optional(),
    times: z.array(z.enum(TIMES)).min(1).optional(),
    light: z.array(z.enum(LIGHTS)).min(1).optional(),
  }),
  /** En el idioma de la narración; sin nombres, cifras ni cosas que se puedan usar (§8). */
  phrases: z.array(z.string().trim().min(1)).min(1),
});
export type AmbienceEntry = z.infer<typeof AmbienceEntry>;
export const AMBIENCE = defineContent("llm/ambience", AmbienceEntry);

/**
 * Una plantilla del narrador sin red: variantes de una frase con huecos (`{who}`, `{to}`,
 * `{target}`, `{what}`, `{words}`, `{text}`). Las elige el rng con clave.
 */
export const NarrationTemplate = z.strictObject({
  id: contentId,
  lines: z.array(z.string().trim().min(1)).min(1),
});
export type NarrationTemplate = z.infer<typeof NarrationTemplate>;
export const NARRATION_TEMPLATES = defineContent("llm/templates", NarrationTemplate);

/**
 * Una palabra del vocabulario de una familia de mundo (narration §4): el concepto que el
 * personaje cree o no, la palabra técnica y cómo la diría quien no la conoce. Lo común
 * (`technical: false`) lo sabe cualquiera de la cultura. Misma forma que `WorldTerm` de `llm`.
 */
export const LexiconEntry = z.strictObject({
  id: contentId,
  /** La familia metafísica a la que pertenece (`xianxia`, `mysteries`…). */
  family: contentId,
  /** `skill.<id>`, `law.<fenómeno>`, o un concepto de la familia (`realm.foundation`). */
  concept: z.string().trim().min(1),
  term: z.string().trim().min(1),
  plain: z.string().trim().min(1),
  technical: z.boolean(),
});
export type LexiconEntry = z.infer<typeof LexiconEntry>;
export const WORLD_LEXICON = defineContent("llm/lexicon", LexiconEntry);

/** Todo `content/`: lo de la sim más lo del narrador. Quien carga la carpeta entera usa esta. */
export const GAME_CONTENT_KINDS: readonly ContentKind[] = [
  ...CONTENT_KINDS,
  AMBIENCE,
  NARRATION_TEMPLATES,
  WORLD_LEXICON,
] as readonly ContentKind[];

/** La paleta de ambiente de una escena percibida (narration §5, §8): lo que vale, en orden de id. */
export function ambienceOf(scene: SceneView, entries: readonly AmbienceEntry[]): string[] {
  const out: string[] = [];
  for (const e of [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const w = e.when;
    if (w.placeKinds && !w.placeKinds.some((k) => scene.placeKinds.includes(k))) continue;
    if (w.spaces && !w.spaces.includes(scene.space)) continue;
    if (w.indoor !== undefined && w.indoor !== scene.indoor) continue;
    if (w.times && !w.times.includes(scene.time)) continue;
    if (w.light && !w.light.includes(scene.light)) continue;
    out.push(...e.phrases);
  }
  return out;
}
