import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../core/index.ts";
import { ACTIONS, ActionCatalog, PLANS, SKILLS, TRAITS } from "../sim/index.ts";
import {
  LlmJobs,
  localLlmConfig,
  MockLLM,
  PARSER_RULES,
  parseIntent,
  parserSetup,
} from "./index.ts";

describe("decisión de perdonar a un rendido", () => {
  it("el contrato distingue spare de habla y no garantiza la conducta del rival", () => {
    expect(PARSER_RULES).toContain("pardoning or releasing them is `spare`");
    expect(PARSER_RULES).toContain("unless they explicitly");
    expect(PARSER_RULES).toContain("never guarantees what the opponent does next");
  });

  it("el catálogo real acepta spare con target sin inventar una intervención", async () => {
    const specs = [
      ["actions", "core"],
      ["plans", "steal"],
      ["skills", "core"],
      ["traits", "human"],
    ] as const;
    const content = loadContent(
      [ACTIONS, PLANS, SKILLS, TRAITS],
      specs.map(([kind, file]) => ({
        kind,
        file: `${kind}/${file}`,
        data: JSON.parse(readFileSync(`content/${kind}/${file}.json`, "utf8")),
      })),
    );
    const setup = parserSetup(new ActionCatalog(content.all(ACTIONS), content.all(PLANS)));
    const draft = {
      kind: "act",
      plan: {
        kind: "do",
        verb: "spare",
        args: [
          {
            role: "target",
            ref: { text: "Tomás", kind: "person", features: ["Tomás"] },
          },
        ],
      },
    };
    const client = new MockLLM([JSON.stringify(draft)]);
    const jobs = new LlmJobs({ config: localLlmConfig("ollama", "mock"), clientFor: () => client });
    const result = await parseIntent(jobs, setup, {
      text: "lo perdono, que se vaya",
      scene: "Tomás está en el suelo, con las manos arriba. Se rindió.",
    });
    expect(result).toMatchObject({ ok: true, value: draft, attempts: 1 });
    expect(client.calls).toHaveLength(1);
  });
});
