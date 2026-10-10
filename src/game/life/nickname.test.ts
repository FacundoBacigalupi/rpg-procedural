import { describe, expect, it } from "vitest";
import { BUTCHER_STANDING, nicknameFor } from "./nickname.ts";

describe("nicknameFor", () => {
  it("agrega el lugar al epíteto del hecho dominante", () => {
    expect(nicknameFor("theft", -0.4, "Valle Alto").text).toBe("el Ladrón de Valle Alto");
    expect(nicknameFor("default", -0.2).text).toBe("el Tramposo");
  });

  it("la violencia muy mal creída sube de Matón a Carnicero", () => {
    expect(nicknameFor("assault", -0.4, "Valle").epithet).toBe("Matón");
    const n = nicknameFor("assault", BUTCHER_STANDING, "Valle");
    expect(n.epithet).toBe("Carnicero");
    expect(n.place).toBe("Valle");
  });
});
