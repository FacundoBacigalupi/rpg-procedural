// El borrador según el catálogo (actions §9, narration §10): el esquema genérico de `intent.ts`
// valida la forma; este lo ata a los verbos, roles, modos y plantillas que hay en `content/`, y a
// los nodos que la Fase 1 sabe ejecutar (`do`, `seq`, `until`, `template`).
//
// Son dos esquemas porque tienen dos trabajos. La restricción de salida que va al modelo es un
// JSON Schema estructural (una variante por verbo, con sus roles como literales), así un modelo
// chico no puede inventar un rol. Pero una unión de variantes da errores ilegibles al validar, y el
// error es lo que se le devuelve al modelo para que regenere. Por eso la validación usa el
// borrador genérico más un control contra el catálogo con mensajes claros. Los dos salen del
// mismo catálogo y los tests comprueban que aceptan y rechazan lo mismo en los ejemplos.

import { z } from "../../core/index.ts";
import type { ActionCatalog, ArgKind } from "./catalog.ts";
import {
  type DraftArg,
  DraftCondition,
  DraftDuration,
  type DraftPlanNode,
  DraftPurpose,
  DraftText,
  type EntityKind,
  IntentDraft,
  type RefDescription,
  RefDescriptionShape,
  SpeechDraft,
} from "./intent.ts";

/** Los nodos que la Fase 1 ejecuta (`planFromDraft` rechaza el resto). */
export const RUNNABLE_NODES = ["do", "seq", "until", "template"] as const;

/** Problemas de un borrador ya bien formado contra el catálogo; vacío es que pasa. En inglés: vuelven al modelo. */
export function draftCatalogProblems(draft: IntentDraft, catalog: ActionCatalog): string[] {
  const problems: string[] = [];
  const allManners = new Set(catalog.verbs.flatMap((v) => v.manners.map((m) => m.id)));
  for (const m of draft.manner ?? []) {
    if (!allManners.has(m)) problems.push(`manner: no verb has the manner "${m}"`);
  }
  if (draft.risksAccepted && draft.risksAccepted.length > 0) {
    problems.push("risksAccepted: there are no risks to accept yet; leave it out");
  }
  if (draft.speech?.manner) {
    const speak = new Set(catalog.verb("speak")?.manners.map((m) => m.id) ?? []);
    for (const m of draft.speech.manner) {
      if (!speak.has(m)) problems.push(`speech.manner: speaking has no manner "${m}"`);
    }
  }
  if (draft.plan) walk(draft.plan, "plan", catalog, problems);
  return problems;
}

function walk(node: DraftPlanNode, at: string, catalog: ActionCatalog, problems: string[]): void {
  switch (node.kind) {
    case "do": {
      const def = catalog.verb(node.verb);
      if (!def) {
        problems.push(`${at}.verb: unknown verb "${node.verb}"; use a listed verb or unmapped`);
        return;
      }
      const seen = new Set<string>();
      node.args.forEach((a, i) => {
        const spec = def.args.find((s) => s.role === a.role);
        if (!spec) {
          const roles = def.args.map((s) => s.role).join(", ") || "none";
          problems.push(`${at}.args.${i}: ${node.verb} has no role "${a.role}" (roles: ${roles})`);
        } else {
          argProblem(a, spec.kind, `${at}.args.${i}`, problems);
        }
        if (seen.has(a.role)) problems.push(`${at}.args.${i}: role "${a.role}" given twice`);
        seen.add(a.role);
      });
      const manners = new Set(def.manners.map((m) => m.id));
      for (const m of node.manner ?? []) {
        if (!manners.has(m)) problems.push(`${at}.manner: ${node.verb} has no manner "${m}"`);
      }
      return;
    }
    case "seq":
      node.steps.forEach((s, i) => {
        walk(s, `${at}.steps.${i}`, catalog, problems);
      });
      return;
    case "until":
      if (!node.cond.is) {
        problems.push(`${at}.cond.is: say which condition it is (dark, light, succeeded, elapsed)`);
      }
      walk(node.body, `${at}.body`, catalog, problems);
      return;
    case "template": {
      const t = catalog.template(node.template);
      if (!t) {
        problems.push(`${at}.template: unknown template "${node.template}"`);
        return;
      }
      for (const p of t.params) {
        const a = node.params[p.id];
        if (a) argProblem(a, p.kind, `${at}.params.${p.id}`, problems);
        else problems.push(`${at}.params: ${t.id} needs "${p.id}"`);
      }
      for (const k of Object.keys(node.params)) {
        if (!t.params.some((p) => p.id === k)) {
          problems.push(`${at}.params: ${t.id} has no parameter "${k}"`);
        }
      }
      return;
    }
    case "repeat":
    case "if":
    case "onEvent":
      problems.push(
        `${at}: "${node.kind}" plans are not available; describe one pass or use unmapped`,
      );
  }
}

function argProblem(a: DraftArg, kind: ArgKind, at: string, problems: string[]): void {
  const has = "ref" in a ? "ref" : "duration" in a ? "duration" : "text";
  const wants = kind === "duration" ? "duration" : kind === "text" ? "text" : "ref";
  if (has !== wants) problems.push(`${at}: "${a.role}" takes a ${wants}, not a ${has}`);
}

/** El borrador genérico más el control contra el catálogo: lo que valida la salida del parser. */
export function intentDraftFor(catalog: ActionCatalog): z.ZodType<IntentDraft> {
  return IntentDraft.superRefine((d, ctx) => {
    for (const message of draftCatalogProblems(d, catalog)) {
      const [path, ...rest] = message.split(": ");
      ctx.addIssue({ code: "custom", path: (path ?? "").split("."), message: rest.join(": ") });
    }
  });
}

/** Qué clases de entidad puede nombrar un argumento de cada tipo. */
const REF_KINDS: Record<"person" | "place" | "thing", readonly [EntityKind, ...EntityKind[]]> = {
  person: ["person", "group"],
  place: ["place"],
  thing: ["object", "lot"],
};

/**
 * Una referencia para restringir la salida: con `kind` obligatorio y de la clase que pide el rol.
 * El borrador genérico lo deja opcional; un modelo chico, si puede, lo saltea.
 */
function refSchema(kinds: readonly [EntityKind, ...EntityKind[]]): z.ZodType<RefDescription> {
  return z.strictObject({
    ...RefDescriptionShape.shape,
    kind: z.enum(kinds),
  }) as unknown as z.ZodType<RefDescription>;
}

function argSchema(role: string, kind: ArgKind): z.ZodType<DraftArg> {
  const r = z.literal(role);
  if (kind === "duration") return z.strictObject({ role: r, duration: DraftDuration });
  if (kind === "text") return z.strictObject({ role: r, text: DraftText });
  return z.strictObject({ role: r, ref: refSchema(REF_KINDS[kind]) });
}

function oneOf<T>(schemas: readonly z.ZodType<T>[]): z.ZodType<T> {
  const [first, ...rest] = schemas;
  if (!first) throw new TypeError("oneOf sin opciones");
  return rest.length === 0 ? first : (z.union([first, ...rest]) as unknown as z.ZodType<T>);
}

const ids = (xs: readonly string[]) => z.enum(xs as [string, ...string[]]);

/** El borrador estructural del catálogo: una variante de `do` por verbo y una por plantilla. */
export function structuralDraftFor(catalog: ActionCatalog): z.ZodType<IntentDraft> {
  const variants: z.ZodType<DraftPlanNode>[] = [];
  for (const v of catalog.verbs) {
    const args =
      v.args.length === 0
        ? z.array(argSchema("none", "text")).max(0)
        : z.array(oneOf(v.args.map((s) => argSchema(s.role, s.kind)))).max(v.args.length);
    const manners = v.manners.map((m) => m.id);
    variants.push(
      z.strictObject({
        kind: z.literal("do"),
        verb: z.literal(v.id),
        args,
        ...(manners.length > 0
          ? { manner: z.array(ids(manners)).max(manners.length).optional() }
          : {}),
      }) as z.ZodType<DraftPlanNode>,
    );
  }
  for (const t of catalog.templates) {
    const params = Object.fromEntries(t.params.map((p) => [p.id, argSchema(p.id, p.kind)]));
    variants.push(
      z.strictObject({
        kind: z.literal("template"),
        template: z.literal(t.id),
        params: z.strictObject(params),
      }) as unknown as z.ZodType<DraftPlanNode>,
    );
  }
  const node: z.ZodType<DraftPlanNode> = oneOf([
    ...variants,
    z.strictObject({
      kind: z.literal("seq"),
      get steps() {
        return z.array(node).min(1).max(16);
      },
    }) as unknown as z.ZodType<DraftPlanNode>,
    z.strictObject({
      kind: z.literal("until"),
      get body() {
        return node;
      },
      // La sim solo usa `is`: en la salida restringida es obligatorio.
      cond: DraftCondition.required({ is: true }),
    }) as unknown as z.ZodType<DraftPlanNode>,
  ]);

  const allManners = [...new Set(catalog.verbs.flatMap((v) => v.manners.map((m) => m.id)))];
  const speakManners = catalog.verb("speak")?.manners.map((m) => m.id) ?? [];
  const texts = z.array(DraftText).max(8).optional();
  return z.strictObject({
    kind: IntentDraft.shape.kind,
    plan: node.optional(),
    // Plano y chico: el motivo del catálogo cerrado y, si lo dice, para quién (una persona).
    purpose: z
      .strictObject({
        motive: DraftPurpose.shape.motive,
        forWhom: refSchema(REF_KINDS.person).optional(),
      })
      .optional(),
    ...(allManners.length > 0 ? { manner: z.array(ids(allManners)).max(8).optional() } : {}),
    constraints: texts,
    stripped: texts,
    unmapped: texts,
    speech: z
      .strictObject({
        text: SpeechDraft.shape.text,
        to: refSchema(REF_KINDS.person).optional(),
        // Plano a propósito: el esquema del modelo se mantiene chico (el control fino es `DraftAct`).
        act: z
          .strictObject({
            kind: z.enum(["greet", "farewell", "ask", "request", "tell", "promise"]),
            about: z.strictObject({ text: DraftText }).optional(),
            claim: z.enum(["dead", "alive"]).optional(),
            what: DraftText.optional(),
          })
          .optional(),
        ...(speakManners.length > 0
          ? { manner: z.array(ids(speakManners)).max(speakManners.length).optional() }
          : {}),
      })
      .optional(),
    text: DraftText.optional(),
  }) as unknown as z.ZodType<IntentDraft>;
}

/** El JSON Schema que restringe la salida del modelo a lo que el catálogo tiene. */
export function intentDraftJsonSchemaFor(catalog: ActionCatalog): Record<string, unknown> {
  return z.toJSONSchema(structuralDraftFor(catalog), {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
