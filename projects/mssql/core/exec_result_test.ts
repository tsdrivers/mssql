import { assertEquals, assertThrows } from "jsr:@std/assert";
import { ExecResult } from "./exec_result.ts";
import type { ExecResultRaw } from "./exec_result.ts";

function makeRaw(overrides: Partial<ExecResultRaw> = {}): ExecResultRaw {
  return {
    rowsAffected: 0,
    resultSets: [],
    outputParams: {},
    ...overrides,
  };
}

Deno.test("ExecResult - rowsAffected", () => {
  const r = new ExecResult(makeRaw({ rowsAffected: 42 }));
  assertEquals(r.rowsAffected, 42);
});

Deno.test("ExecResult - resultSets count", () => {
  const r = new ExecResult(
    makeRaw({ resultSets: [[{ id: 1 }], [{ name: "a" }]] }),
  );
  assertEquals(r.resultSets, 2);
});

Deno.test("ExecResult - resultSets zero when empty", () => {
  const r = new ExecResult(makeRaw());
  assertEquals(r.resultSets, 0);
});

Deno.test("ExecResult - getOutput returns value", () => {
  const r = new ExecResult(
    makeRaw({ outputParams: { myParam: 42, other: "hello" } }),
  );
  assertEquals(r.getOutput<number>("myParam"), 42);
  assertEquals(r.getOutput<string>("other"), "hello");
});

Deno.test("ExecResult - getOutput strips @ prefix", () => {
  const r = new ExecResult(makeRaw({ outputParams: { myParam: 99 } }));
  assertEquals(r.getOutput<number>("@myParam"), 99);
});

Deno.test("ExecResult - getOutput throws on missing", () => {
  const r = new ExecResult(makeRaw({ outputParams: { a: 1 } }));
  assertThrows(
    () => r.getOutput("missing"),
    Error,
    "Output parameter 'missing' not found",
  );
});

Deno.test("ExecResult - getOutput returns null values", () => {
  const r = new ExecResult(makeRaw({ outputParams: { x: null } }));
  assertEquals(r.getOutput("x"), null);
});

Deno.test("ExecResult - getResults returns rows", () => {
  const rows = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];
  const r = new ExecResult(makeRaw({ resultSets: [rows] }));
  assertEquals(r.getResults(0), rows);
});

Deno.test("ExecResult - getResults throws on out of range", () => {
  const r = new ExecResult(makeRaw({ resultSets: [[{ id: 1 }]] }));
  assertThrows(() => r.getResults(1), RangeError, "out of range");
  assertThrows(() => r.getResults(-1), RangeError, "out of range");
});

Deno.test("ExecResult - getResultFirst returns first row", () => {
  const rows = [{ id: 1 }, { id: 2 }];
  const r = new ExecResult(makeRaw({ resultSets: [rows] }));
  assertEquals(r.getResultFirst(0), { id: 1 });
});

Deno.test("ExecResult - getResultFirst returns undefined for empty set", () => {
  const r = new ExecResult(makeRaw({ resultSets: [[]] }));
  assertEquals(r.getResultFirst(0), undefined);
});

Deno.test("ExecResult - multiple result sets", () => {
  const rs0 = [{ a: 1 }];
  const rs1 = [{ b: 2 }, { b: 3 }];
  const r = new ExecResult(makeRaw({ resultSets: [rs0, rs1] }));
  assertEquals(r.resultSets, 2);
  assertEquals(r.getResults(0), rs0);
  assertEquals(r.getResults(1), rs1);
  assertEquals(r.getResultFirst(0), { a: 1 });
  assertEquals(r.getResultFirst(1), { b: 2 });
});
