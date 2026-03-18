import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { newCOMB } from "./comb.ts";

Deno.test("newCOMB - returns valid UUID format", () => {
  const uuid = newCOMB();
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assertEquals(pattern.test(uuid), true, `Invalid UUID format: ${uuid}`);
});

Deno.test("newCOMB - version 4 bit is set", () => {
  const uuid = newCOMB();
  // 13th character should be '4' (version nibble)
  assertEquals(uuid[14], "4");
});

Deno.test("newCOMB - variant bits are set", () => {
  const uuid = newCOMB();
  // 17th character should be 8, 9, a, or b (variant bits)
  const variant = uuid[19];
  assertEquals(
    ["8", "9", "a", "b"].includes(variant),
    true,
    `Invalid variant: ${variant}`,
  );
});

Deno.test("newCOMB - generates unique values", () => {
  const uuids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    uuids.add(newCOMB());
  }
  assertEquals(uuids.size, 100, "Expected 100 unique UUIDs");
});

Deno.test("newCOMB - sequential COMBs have increasing last 12 chars", () => {
  const combs: string[] = [];
  for (let i = 0; i < 10; i++) {
    combs.push(newCOMB());
  }

  // The last segment (bytes 10-15) should be monotonically non-decreasing
  // since it encodes Date.now()
  for (let i = 1; i < combs.length; i++) {
    const prev = combs[i - 1].slice(24); // last 12 hex chars
    const curr = combs[i].slice(24);
    assertEquals(
      curr >= prev,
      true,
      `COMB ${i} (${curr}) should be >= COMB ${i - 1} (${prev})`,
    );
  }
});

Deno.test("newCOMB - timestamp encodes current time", () => {
  const before = Date.now();
  const uuid = newCOMB();
  const after = Date.now();

  // Extract timestamp from last 6 bytes (last 12 hex chars)
  const hex = uuid.slice(24);
  const ts = parseInt(hex, 16);

  assertEquals(ts >= before, true, `Timestamp ${ts} should be >= ${before}`);
  assertEquals(ts <= after, true, `Timestamp ${ts} should be <= ${after}`);
});

Deno.test("newCOMB - has correct length", () => {
  const uuid = newCOMB();
  assertEquals(uuid.length, 36, "UUID should be 36 characters (with hyphens)");
});
