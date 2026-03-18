import { assertEquals } from "jsr:@std/assert";
import { UTF8_COLLATIONS, utf8Column } from "./collation.ts";

Deno.test("UTF8_COLLATIONS - has expected values", () => {
  assertEquals(
    UTF8_COLLATIONS.CI_AS,
    "LATIN1_GENERAL_100_CI_AS_SC_UTF8",
  );
  assertEquals(
    UTF8_COLLATIONS.CS_AS,
    "LATIN1_GENERAL_100_CS_AS_SC_UTF8",
  );
  assertEquals(
    UTF8_COLLATIONS.BIN2,
    "LATIN1_GENERAL_100_BIN2_UTF8",
  );
});

Deno.test("utf8Column - default collation", () => {
  const result = utf8Column("Name", "varchar(200)");
  assertEquals(result, "[Name] varchar(200) COLLATE LATIN1_GENERAL_100_CI_AS_SC_UTF8");
});

Deno.test("utf8Column - custom collation", () => {
  const result = utf8Column("Slug", "varchar(100)", UTF8_COLLATIONS.BIN2);
  assertEquals(result, "[Slug] varchar(100) COLLATE LATIN1_GENERAL_100_BIN2_UTF8");
});

Deno.test("utf8Column - case-sensitive collation", () => {
  const result = utf8Column("Code", "varchar(50)", UTF8_COLLATIONS.CS_AS);
  assertEquals(result, "[Code] varchar(50) COLLATE LATIN1_GENERAL_100_CS_AS_SC_UTF8");
});

Deno.test("utf8Column - varchar(max)", () => {
  const result = utf8Column("Body", "varchar(max)");
  assertEquals(result, "[Body] varchar(max) COLLATE LATIN1_GENERAL_100_CI_AS_SC_UTF8");
});
