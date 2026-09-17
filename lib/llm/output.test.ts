import { describe, expect, it } from "vitest";
import { sanitizeAssistantText, stripMarkdownLinks } from "./output";

describe("assistant output cleanup", () => {
  it("removes complete reasoning blocks from assistant text", () => {
    expect(sanitizeAssistantText("<think>private reasoning</think>Hi! How can I help?")).toBe("Hi! How can I help?");
  });

  it("removes unfinished reasoning blocks while streaming", () => {
    expect(sanitizeAssistantText("Hello<think>still reasoning")).toBe("Hello");
  });

  it("converts markdown links to their label only", () => {
    expect(stripMarkdownLinks("Va à [Aqualand](https://www.aqualand.fr) demain")).toBe("Va à Aqualand demain");
  });

  it("unwraps links that sit alone inside parentheses", () => {
    expect(stripMarkdownLinks("Le marché ([frejus.fr](https://frejus.fr?utm_source=openai)) ouvre ce soir."))
      .toBe("Le marché frejus.fr ouvre ce soir.");
  });

  it("drops links with an empty label entirely", () => {
    expect(sanitizeAssistantText("Info [](https://example.com) ici")).toBe("Info  ici");
  });

  it("strips links in sanitized assistant text used for display and TTS", () => {
    expect(sanitizeAssistantText("Ce soir : [le marché nocturne](https://frejus-tourisme.com) ou [la plage](https://example.org/plage)."))
      .toBe("Ce soir : le marché nocturne ou la plage.");
  });

  it("leaves plain text without links untouched", () => {
    expect(sanitizeAssistantText("Simple phrase sans lien.")).toBe("Simple phrase sans lien.");
  });

  it("strips links combined with think blocks in one pass", () => {
    expect(sanitizeAssistantText("<think>secret [x](https://x.fr)</think>Voir [la plage](https://plage.fr)."))
      .toBe("Voir la plage.");
  });

  it("strips a link at the end of a sentence", () => {
    expect(sanitizeAssistantText("Découvre la ville sur [le site officiel](https://ville.fr)."))
      .toBe("Découvre la ville sur le site officiel.");
  });
});
