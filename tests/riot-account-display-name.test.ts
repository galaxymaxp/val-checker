import { describe, expect, it } from "vitest";

import { riotAccountDisplayName } from "@/src/lib/riot/account-display";

describe("riotAccountDisplayName", () => {
  it("prefers the resolved Riot ID over the editable label", () => {
    expect(
      riotAccountDisplayName(
        { gameName: "PlayerOne", label: "Smurf", tagLine: "NA1" },
        0,
      ),
    ).toBe("PlayerOne#NA1");
  });

  it("falls back to the label until Riot supplies an ID", () => {
    expect(
      riotAccountDisplayName({ gameName: null, label: "Main", tagLine: null }, 0),
    ).toBe("Main");
  });

  it("never renders a half Riot ID", () => {
    expect(
      riotAccountDisplayName(
        { gameName: "PlayerOne", label: "Main", tagLine: null },
        0,
      ),
    ).toBe("Main");
    expect(
      riotAccountDisplayName({ gameName: null, label: null, tagLine: "NA1" }, 1),
    ).toBe("Riot account 2");
  });

  it("numbers unnamed accounts from one, ignoring blank labels", () => {
    expect(
      riotAccountDisplayName({ gameName: null, label: "   ", tagLine: null }, 2),
    ).toBe("Riot account 3");
  });
});
