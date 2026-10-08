// El contrato JSON entre el servidor local y el cliente: solo tipos, sin imports.

export interface Panels {
  readonly now: string;
  readonly character: string;
  readonly inventory: string;
  readonly journal: string;
}

export interface WebState extends Panels {
  readonly opening: string;
}

export interface SayResponse extends Panels {
  readonly text: string;
  readonly end: "quit" | "dead" | null;
}
