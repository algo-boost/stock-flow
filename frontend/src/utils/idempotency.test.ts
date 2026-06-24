import { describe, expect, it } from "vitest";
import { newIdempotencyKey } from "./idempotency";

describe("idempotency", () => {
  it("newIdempotencyKey 返回非空字符串", () => {
    const key = newIdempotencyKey();
    expect(key.length).toBeGreaterThan(8);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});
