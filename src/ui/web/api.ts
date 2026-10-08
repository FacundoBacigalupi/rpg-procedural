// El contrato JSON entre el servidor local y el cliente: solo tipos, sin imports.

export interface Panels {
  readonly now: string;
  readonly character: string;
  readonly inventory: string;
  readonly journal: string;
  /** Lo que se nota del lugar, por canal. */
  readonly environment: string;
  /** Las opciones sugeridas; `choose` manda el `id`. */
  readonly options: readonly { readonly id: string; readonly label: string }[];
}

export interface WebState extends Panels {
  readonly opening: string;
}

export interface SayResponse extends Panels {
  readonly text: string;
  readonly end: "quit" | "dead" | null;
}
