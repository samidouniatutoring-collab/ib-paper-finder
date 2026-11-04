import { describe, expect, it } from "vitest";
import { cleanBody, snippetParts } from "../src/lib/snippet";

describe("snippetParts", () => {
  it("splits highlighted words", () => {
    expect(snippetParts("A ⟦bakery⟧ sells\n ⟦cakes⟧.")).toEqual([
      { text: "A ", hit: false }, { text: "bakery", hit: true }, { text: " sells ", hit: false }, { text: "cakes", hit: true }, { text: ".", hit: false },
    ]);
  });
  it("handles no highlight and stray markers", () => {
    expect(snippetParts("plain text")).toEqual([{ text: "plain text", hit: false }]);
    expect(snippetParts("a ⟦b")).toEqual([{ text: "a b", hit: false }]);
  });
});

describe("cleanBody", () => {
  it("removes NUL characters and collapses spaces", () => {
    expect(cleanBody("  a\u0000b   c \n d ")).toBe("ab c \n d");
  });
});
