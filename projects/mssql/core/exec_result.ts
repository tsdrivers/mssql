/**
 * ExecResult — rich result from exec() with OUTPUT params and multiple result sets.
 * @module
 */

/** Raw JSON shape returned by the mssql_exec FFI function. */
export interface ExecResultRaw {
  rowsAffected: number;
  resultSets: Record<string, unknown>[][];
  outputParams: Record<string, unknown>;
}

/**
 * Result from `exec()` — supports OUTPUT parameters and multiple result sets.
 *
 * @example
 * ```ts
 * const result = await cn.exec("sp_MyProc", {
 *   input: 42,
 *   output: { value: null, type: "int", output: true },
 * }, { commandType: "stored_procedure" });
 *
 * result.rowsAffected;             // number
 * result.resultSets;               // number (count)
 * result.getOutput<number>("output"); // OUTPUT param value
 * result.getResults<T>(0);          // T[] from result set 0
 * result.getResultFirst<T>(0);      // T | undefined
 * ```
 */
export class ExecResult {
  /** Number of rows affected by the statement. */
  readonly rowsAffected: number;

  /** Number of result sets returned. */
  readonly resultSets: number;

  readonly #data: ExecResultRaw;

  /** @internal */
  constructor(raw: ExecResultRaw) {
    this.#data = raw;
    this.rowsAffected = raw.rowsAffected;
    this.resultSets = raw.resultSets.length;
  }

  /**
   * Get the value of an OUTPUT parameter by name.
   * The `@` prefix is optional — `getOutput("myParam")` and
   * `getOutput("@myParam")` are equivalent.
   *
   * @throws If the named output parameter does not exist.
   */
  getOutput<T = unknown>(name: string): T {
    const clean = name.startsWith("@") ? name.slice(1) : name;
    if (!(clean in this.#data.outputParams)) {
      throw new Error(`Output parameter '${clean}' not found`);
    }
    return this.#data.outputParams[clean] as T;
  }

  /**
   * Get all rows from the result set at the given index.
   *
   * @throws If the index is out of range.
   */
  getResults<T = Record<string, unknown>>(index: number): T[] {
    if (index < 0 || index >= this.#data.resultSets.length) {
      throw new RangeError(
        `Result set index ${index} out of range (0..${
          this.#data.resultSets.length - 1
        })`,
      );
    }
    return this.#data.resultSets[index] as T[];
  }

  /**
   * Get the first row from the result set at the given index, or undefined.
   *
   * @throws If the index is out of range.
   */
  getResultFirst<T = Record<string, unknown>>(index: number): T | undefined {
    return this.getResults<T>(index)[0];
  }
}
