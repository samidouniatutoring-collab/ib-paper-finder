import { describe, expect, it } from "vitest";
import { isNetworkError, withOffline } from "../src/offline";

describe("offline helpers", () => {
  it("tells network failures from server refusals", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError({ message: "TypeError: Load failed" })).toBe(true);
    expect(isNetworkError({ message: "new row violates row-level security policy" })).toBe(false);
    expect(isNetworkError(new Error("Object not found"))).toBe(false);
  });

  it("passes results through and keeps server errors as they are", async () => {
    expect(await withOffline("k", async () => 5)).toBe(5);
    await expect(withOffline("k", async () => { throw new Error("permission denied"); })).rejects.toThrow("permission denied");
    await expect(withOffline("k", async () => { throw new TypeError("Failed to fetch"); })).rejects.toThrow(/offline/i);
  });
});
