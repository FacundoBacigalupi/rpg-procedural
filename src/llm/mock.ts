// `MockLLM` (ARCHITECTURE §2): un cliente con respuestas armadas a mano, para que el turno, el
// parser y los trabajos se prueben sin red ni modelo. Guarda cada pedido para mirarlo después.

import type { LlmClient, LlmRequest, LlmResponse } from "./client.ts";

/** Una respuesta: texto, la respuesta entera, o un error para simular un modelo caído. */
export type MockReply = string | LlmResponse | Error;

export class MockLLM implements LlmClient {
  readonly name: string;
  readonly calls: LlmRequest[] = [];
  readonly #reply: (request: LlmRequest, n: number) => MockReply;

  /**
   * Con una lista, contesta en orden (y se queja si se le acaban); con una función, contesta lo
   * que devuelva para cada pedido y su número.
   */
  constructor(
    replies: readonly MockReply[] | ((request: LlmRequest, n: number) => MockReply),
    name = "mock",
  ) {
    this.name = name;
    if (typeof replies === "function") {
      this.#reply = replies;
    } else {
      const queue = [...replies];
      this.#reply = (_, n) => {
        const r = queue.shift();
        if (r === undefined) throw new Error(`${name}: no hay respuesta para el pedido #${n}`);
        return r;
      };
    }
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const r = this.#reply(request, this.calls.length);
    if (r instanceof Error) throw r;
    return typeof r === "string" ? { text: r, model: this.name } : r;
  }
}
