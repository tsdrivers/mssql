use std::collections::HashMap;

use odbc_api::buffers::TextRowSet;
use odbc_api::{Connection, Cursor};
use serde::Deserialize;

use crate::error::{MssqlError, Result};

// ── Serialized command from TypeScript ─────────────────────────

#[derive(Debug, Deserialize)]
pub struct SerializedCommand {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<SerializedParam>,
    #[allow(dead_code)] // Deserialized from JSON, reserved for future use
    pub transaction_id: Option<String>,
    #[allow(dead_code)] // Deserialized from JSON, reserved for future use
    pub command_timeout_ms: Option<u64>,
    pub command_type: String,
    // Legacy fields from cursor mode — accepted but ignored
    #[serde(default)]
    #[allow(dead_code)]
    pub stream_mode: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    pub fetch_size: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SerializedParam {
    pub name: String,
    pub value: serde_json::Value,
    #[serde(rename = "type")]
    pub param_type: Option<String>,
    #[serde(default)]
    pub output: bool,
}

// ── Named param rewriting (@name → @P1) ──────────────────────

fn is_sql_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Rewrite named @param placeholders to positional @P1, @P2, ... markers.
/// Returns the rewritten SQL and the reordered parameter indices.
pub fn rewrite_named_params(
    sql: &str,
    params: &[SerializedParam],
) -> (String, Vec<usize>) {
    if params.is_empty() {
        return (sql.to_string(), vec![]);
    }

    let mut name_to_idx: HashMap<String, usize> = HashMap::new();
    for (i, param) in params.iter().enumerate() {
        let clean = param.name.trim_start_matches('@');
        name_to_idx.insert(clean.to_lowercase(), i);
    }

    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut result = String::with_capacity(sql.len());
    let mut order: Vec<usize> = Vec::new();
    let mut pos = 0;
    let mut i = 0;

    while i < len {
        // Skip single-quoted string literals
        if chars[i] == '\'' {
            result.push(chars[i]);
            i += 1;
            while i < len {
                if chars[i] == '\'' {
                    result.push(chars[i]);
                    i += 1;
                    if i < len && chars[i] == '\'' {
                        result.push(chars[i]);
                        i += 1;
                    } else {
                        break;
                    }
                } else {
                    result.push(chars[i]);
                    i += 1;
                }
            }
            continue;
        }

        if chars[i] == '@' {
            // Skip @@ system variables
            if i + 1 < len && chars[i + 1] == '@' {
                result.push(chars[i]);
                result.push(chars[i + 1]);
                i += 2;
                while i < len && is_sql_ident_char(chars[i]) {
                    result.push(chars[i]);
                    i += 1;
                }
                continue;
            }

            let start = i + 1;
            let mut end = start;
            while end < len && is_sql_ident_char(chars[end]) {
                end += 1;
            }

            if end > start {
                let name: String = chars[start..end].iter().collect();
                if let Some(&idx) = name_to_idx.get(&name.to_lowercase()) {
                    pos += 1;
                    result.push_str(&format!("@P{pos}"));
                    order.push(idx);
                    i = end;
                    continue;
                }
            }
        }

        result.push(chars[i]);
        i += 1;
    }

    (result, order)
}

// ── SQL literal conversion (for OUTPUT param batches) ─────────

/// Convert a param value to a SQL literal string for embedding in
/// simple_query batches (OUTPUT params, etc.).
pub fn param_to_literal(param: &SerializedParam) -> Result<String> {
    match &param.value {
        serde_json::Value::Null => Ok("NULL".to_string()),
        serde_json::Value::Bool(b) => Ok(if *b { "1" } else { "0" }.to_string()),
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.is_nan() || f.is_infinite() {
                    return Ok("NULL".to_string());
                }
            }
            Ok(n.to_string())
        }
        serde_json::Value::String(s) => {
            match param.param_type.as_deref() {
                Some("uniqueidentifier") => {
                    uuid::Uuid::parse_str(s)
                        .map_err(|e| MssqlError::Query(format!("Invalid UUID: {e}")))?;
                    Ok(format!("'{s}'"))
                }
                Some("varbinary") => {
                    use base64::Engine;
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(s)
                        .map_err(|e| MssqlError::Query(format!("Invalid base64: {e}")))?;
                    if bytes.is_empty() {
                        Ok("CAST(0x AS VARBINARY(MAX))".to_string())
                    } else {
                        let hex: String = bytes.iter().map(|b| format!("{b:02X}")).collect();
                        Ok(format!("0x{hex}"))
                    }
                }
                _ => Ok(format!("N'{}'", s.replace('\'', "''"))),
            }
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            let json_str = serde_json::to_string(&param.value).unwrap();
            Ok(format!("N'{}'", json_str.replace('\'', "''")))
        }
    }
}

/// Map a type hint string to a SQL Server DECLARE type.
pub fn sql_type_for_declare(type_hint: &str) -> Result<&'static str> {
    match type_hint.to_lowercase().as_str() {
        "int" => Ok("INT"),
        "bigint" => Ok("BIGINT"),
        "smallint" => Ok("SMALLINT"),
        "tinyint" => Ok("TINYINT"),
        "float" => Ok("FLOAT"),
        "real" => Ok("REAL"),
        "decimal" => Ok("DECIMAL(38, 18)"),
        "bit" => Ok("BIT"),
        "varchar" => Ok("VARCHAR(MAX)"),
        "nvarchar" => Ok("NVARCHAR(MAX)"),
        "text" => Ok("TEXT"),
        "ntext" => Ok("NTEXT"),
        "char" => Ok("CHAR(1)"),
        "nchar" => Ok("NCHAR(1)"),
        "date" => Ok("DATE"),
        "datetime" => Ok("DATETIME"),
        "datetime2" => Ok("DATETIME2"),
        "datetimeoffset" => Ok("DATETIMEOFFSET"),
        "time" => Ok("TIME"),
        "uniqueidentifier" => Ok("UNIQUEIDENTIFIER"),
        "varbinary" => Ok("VARBINARY(MAX)"),
        "xml" => Ok("XML"),
        "json" => Ok("NVARCHAR(MAX)"),
        other => Err(MssqlError::Query(format!("Unknown SQL type: {other}"))),
    }
}

// ── ODBC cursor → JSON helpers ──────────────────────────────────

/// Read all rows from an ODBC cursor into a Vec of JSON objects.
/// Uses text-mode fetching: all column values come back as strings,
/// which we then parse based on column metadata.
///
/// This is also used by bulk.rs for reading @@ROWCOUNT results.
pub fn cursor_to_json_rows_internal(cursor: impl Cursor) -> Result<Vec<serde_json::Value>> {
    cursor_to_json_rows(cursor)
}

/// Read all rows from a single result set of an ODBC cursor.
/// Takes ownership of the cursor, reads rows, then returns the cursor
/// so `more_results()` can be called on it.
fn read_result_set_owned<C: Cursor>(mut cursor: C) -> Result<(Vec<serde_json::Value>, C)> {
    let num_cols = cursor.num_result_cols().map_err(MssqlError::from)? as u16;
    if num_cols == 0 {
        return Ok((vec![], cursor));
    }

    // Collect column names and types
    let mut col_names: Vec<String> = Vec::with_capacity(num_cols as usize);
    let mut col_types: Vec<i16> = Vec::with_capacity(num_cols as usize);
    for i in 1..=num_cols {
        let desc = cursor.col_data_type(i).map_err(MssqlError::from)?;
        let name = cursor.col_name(i).map_err(MssqlError::from)?;
        col_names.push(name);
        col_types.push(odbc_data_type_to_hint(&desc));
    }

    let batch_size = 1000;
    let max_str_len = 65536;
    let buffer = TextRowSet::for_cursor(batch_size, &mut cursor, Some(max_str_len))
        .map_err(|e| MssqlError::Query(format!("Failed to create row buffer: {e}")))?;
    let mut block_cursor = cursor
        .bind_buffer(buffer)
        .map_err(|e| MssqlError::Query(format!("Failed to bind buffer: {e}")))?;

    let mut rows = Vec::new();

    while let Some(batch) = block_cursor.fetch().map_err(MssqlError::from)? {
        let num_rows = batch.num_rows();
        for row_idx in 0..num_rows {
            let mut map = serde_json::Map::with_capacity(num_cols as usize);
            for col_idx in 0..num_cols as usize {
                let value = match batch.at(col_idx, row_idx) {
                    Some(bytes) => {
                        let text = String::from_utf8_lossy(bytes);
                        text_to_json_value(&text, col_types[col_idx])
                    }
                    None => serde_json::Value::Null,
                };
                map.insert(col_names[col_idx].clone(), value);
            }
            rows.push(serde_json::Value::Object(map));
        }
    }

    // Unbind the buffer to get the cursor back for more_results()
    let (cursor, _buffer) = block_cursor.unbind().map_err(MssqlError::from)?;

    Ok((rows, cursor))
}

fn cursor_to_json_rows(cursor: impl Cursor) -> Result<Vec<serde_json::Value>> {
    let (rows, _cursor) = read_result_set_owned(cursor)?;
    Ok(rows)
}

/// Collect all result sets from a statement execution.
/// Uses `more_results()` to iterate through multiple result sets.
fn collect_all_result_sets(
    conn: &Connection<'static>,
    sql: &str,
) -> Result<Vec<Vec<serde_json::Value>>> {
    let mut all_sets: Vec<Vec<serde_json::Value>> = Vec::new();

    if let Some(cursor) = conn.execute(sql, ()).map_err(MssqlError::from)? {
        // Read first result set (returns cursor for more_results)
        let (rows, cursor) = read_result_set_owned(cursor)?;
        all_sets.push(rows);

        // Iterate remaining result sets
        let mut maybe_next = cursor.more_results().map_err(MssqlError::from)?;
        while let Some(next_cursor) = maybe_next {
            let (rows, cursor) = read_result_set_owned(next_cursor)?;
            all_sets.push(rows);
            maybe_next = cursor.more_results().map_err(MssqlError::from)?;
        }
    }

    Ok(all_sets)
}

/// Map ODBC DataType to a numeric hint for JSON conversion.
/// Positive = numeric, negative = special handling.
const HINT_STRING: i16 = 0;
const HINT_INT: i16 = 1;
const HINT_BIGINT: i16 = 2;
const HINT_FLOAT: i16 = 3;
const HINT_BIT: i16 = 4;
const HINT_BINARY: i16 = 5;
const HINT_DECIMAL: i16 = 6;

fn odbc_data_type_to_hint(dt: &odbc_api::DataType) -> i16 {
    use odbc_api::DataType;
    match dt {
        DataType::TinyInt => HINT_INT,
        DataType::SmallInt => HINT_INT,
        DataType::Integer => HINT_INT,
        DataType::BigInt => HINT_BIGINT,
        DataType::Float { .. } => HINT_FLOAT,
        DataType::Real => HINT_FLOAT,
        DataType::Double => HINT_FLOAT,
        DataType::Bit => HINT_BIT,
        DataType::Binary { .. } | DataType::Varbinary { .. } | DataType::LongVarbinary { .. } => {
            HINT_BINARY
        }
        DataType::Decimal { .. } | DataType::Numeric { .. } => HINT_DECIMAL,
        _ => HINT_STRING,
    }
}

/// Convert text (from ODBC) + type hint to a JSON value.
fn text_to_json_value(text: &str, hint: i16) -> serde_json::Value {
    match hint {
        HINT_INT => {
            if let Ok(n) = text.parse::<i32>() {
                serde_json::json!(n)
            } else {
                serde_json::Value::String(text.to_string())
            }
        }
        HINT_BIGINT => {
            if let Ok(n) = text.parse::<i64>() {
                // JavaScript safe integer range
                if (-(1i64 << 53)..=(1i64 << 53)).contains(&n) {
                    serde_json::json!(n)
                } else {
                    serde_json::Value::String(n.to_string())
                }
            } else {
                serde_json::Value::String(text.to_string())
            }
        }
        HINT_FLOAT => {
            if let Ok(f) = text.parse::<f64>() {
                serde_json::json!(f)
            } else {
                serde_json::Value::String(text.to_string())
            }
        }
        HINT_BIT => {
            serde_json::Value::Bool(text == "1" || text.eq_ignore_ascii_case("true"))
        }
        HINT_BINARY => {
            // ODBC TextRowSet returns binary data as hex string (e.g. "48656C6C6F").
            // We decode the hex to bytes, then base64-encode for the TS layer.
            use base64::Engine;
            match hex_to_bytes(text) {
                Some(bytes) => serde_json::Value::String(
                    base64::engine::general_purpose::STANDARD.encode(&bytes),
                ),
                None => {
                    // Fallback: treat as raw bytes if hex decode fails
                    serde_json::Value::String(
                        base64::engine::general_purpose::STANDARD.encode(text.as_bytes()),
                    )
                }
            }
        }
        HINT_DECIMAL => {
            // Return decimals as strings to preserve precision
            serde_json::Value::String(text.to_string())
        }
        _ => {
            // String types: dates, times, GUIDs, XML, etc.
            serde_json::Value::String(text.to_string())
        }
    }
}

/// Decode a hex string (e.g. "48656C6C6F") to bytes.
fn hex_to_bytes(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for chunk in hex.as_bytes().chunks(2) {
        let hi = hex_digit(chunk[0])?;
        let lo = hex_digit(chunk[1])?;
        bytes.push((hi << 4) | lo);
    }
    Some(bytes)
}

fn hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

// ── Build SQL with embedded parameter literals ──────────────────

/// For parameterized queries, we embed parameter values directly into the SQL
/// as literals. This is simpler than ODBC parameter binding and works
/// correctly with all SQL Server types. Named parameters are rewritten to
/// positional literals.
///
/// Security: All string values are properly escaped (single quotes doubled).
/// This is an internal function — the SQL never comes from untrusted sources
/// (it's always from the TS layer which already does its own escaping).
fn build_sql_with_params(cmd: &SerializedCommand) -> Result<String> {
    if cmd.params.is_empty() {
        return Ok(cmd.sql.clone());
    }

    let (rewritten_sql, order) = rewrite_named_params(&cmd.sql, &cmd.params);

    // Replace @P1, @P2, ... with literal values
    let mut result = rewritten_sql;
    // Process in reverse order to avoid offset issues
    for (pos_idx, &param_idx) in order.iter().enumerate().rev() {
        let placeholder = format!("@P{}", pos_idx + 1);
        let literal = param_to_literal(&cmd.params[param_idx])?;
        result = result.replacen(&placeholder, &literal, 1);
    }

    Ok(result)
}

// ── Query execution ───────────────────────────────────────────

/// Execute a query and return a JSON array of rows.
pub fn execute_query(
    conn: &Connection<'static>,
    cmd: &SerializedCommand,
) -> Result<String> {
    let sql = build_sql_with_params(cmd)?;

    match conn.execute(&sql, ()).map_err(MssqlError::from)? {
        Some(cursor) => {
            let rows = cursor_to_json_rows(cursor)?;
            Ok(serde_json::to_string(&rows).unwrap())
        }
        None => Ok("[]".to_string()),
    }
}

/// Execute a non-query and return JSON { rowsAffected }.
pub fn execute_nonquery(
    conn: &Connection<'static>,
    cmd: &SerializedCommand,
) -> Result<String> {
    let sql = build_sql_with_params(cmd)?;

    // Execute via conn.execute() which doesn't hold a borrow on a statement.
    // For DML (no cursor), we use a separate approach to get row_count.
    match conn.execute(&sql, ()).map_err(MssqlError::from)? {
        Some(cursor) => {
            // SELECT or similar — consume cursor, rowsAffected is 0
            let _ = cursor_to_json_rows(cursor)?;
            Ok(serde_json::json!({ "rowsAffected": 0 }).to_string())
        }
        None => {
            // DML (INSERT/UPDATE/DELETE) — no cursor.
            // Get row count by executing a separate @@ROWCOUNT query.
            let rows_affected = match conn.execute("SELECT @@ROWCOUNT AS __rc", ()).map_err(MssqlError::from)? {
                Some(cursor) => {
                    let rows = cursor_to_json_rows(cursor)?;
                    rows.first()
                        .and_then(|r| r.get("__rc"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0)
                }
                None => 0,
            };
            Ok(serde_json::json!({ "rowsAffected": rows_affected }).to_string())
        }
    }
}

/// Execute a stored procedure or complex query and return JSON with
/// result sets, rows affected, and output parameters.
pub fn execute_exec(
    conn: &Connection<'static>,
    cmd: &SerializedCommand,
) -> Result<String> {
    let has_output = cmd.params.iter().any(|p| p.output);

    if has_output {
        execute_exec_with_output(conn, cmd)
    } else {
        execute_exec_simple(conn, cmd)
    }
}

/// exec without OUTPUT params — collect result sets.
fn execute_exec_simple(
    conn: &Connection<'static>,
    cmd: &SerializedCommand,
) -> Result<String> {
    let sql = build_sql_with_params(cmd)?;

    // Append SELECT @@ROWCOUNT to capture rows affected
    let sql_with_rc = format!("{sql}; SELECT @@ROWCOUNT AS __rc");

    let mut result_sets: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut rows_affected: i64 = 0;

    let all_sets = collect_all_result_sets(conn, &sql_with_rc)?;
    for rows in all_sets {
        process_result_set_rows(rows, &[], &mut result_sets, &mut rows_affected, &mut serde_json::Map::new());
    }

    Ok(serde_json::json!({
        "rowsAffected": rows_affected,
        "resultSets": result_sets,
        "outputParams": {},
    })
    .to_string())
}

/// exec with OUTPUT params — build a batch with DECLARE/EXEC/SELECT.
fn execute_exec_with_output(
    conn: &Connection<'static>,
    cmd: &SerializedCommand,
) -> Result<String> {
    // Build DECLARE + EXEC batch with OUTPUT params
    let mut batch = String::new();
    let mut output_names: Vec<String> = Vec::new();

    for param in &cmd.params {
        let clean = param.name.trim_start_matches('@');
        if param.output {
            let sql_type = if let Some(ref t) = param.param_type {
                sql_type_for_declare(t)?
            } else {
                "NVARCHAR(MAX)"
            };
            batch.push_str(&format!("DECLARE @{clean} {sql_type};\n"));
            output_names.push(clean.to_string());
            // If the param has an input value too, set it
            if !param.value.is_null() {
                let val = param_to_literal(param)?;
                batch.push_str(&format!("SET @{clean} = {val};\n"));
            }
        }
    }

    // Build EXEC call
    if cmd.command_type == "stored_procedure" {
        batch.push_str(&format!("EXEC {} ", cmd.sql));
    } else {
        batch.push_str(&cmd.sql);
        batch.push_str(";\n");
    }

    if cmd.command_type == "stored_procedure" {
        let mut param_parts: Vec<String> = Vec::new();
        for param in &cmd.params {
            let clean = param.name.trim_start_matches('@');
            if param.output {
                param_parts.push(format!("@{clean} = @{clean} OUTPUT"));
            } else {
                let val = param_to_literal(param)?;
                param_parts.push(format!("@{clean} = {val}"));
            }
        }
        batch.push_str(&param_parts.join(", "));
        batch.push_str(";\n");
    }

    // SELECT output values
    if !output_names.is_empty() {
        batch.push_str("SELECT ");
        let selects: Vec<String> = output_names
            .iter()
            .map(|n| format!("@{n} AS [{n}]"))
            .collect();
        batch.push_str(&selects.join(", "));
        batch.push_str(";\n");
    }

    batch.push_str("SELECT @@ROWCOUNT AS __rc;\n");

    // Execute the batch
    let mut result_sets: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut rows_affected: i64 = 0;
    let mut output_params = serde_json::Map::new();

    let all_sets = collect_all_result_sets(conn, &batch)?;
    for rows in all_sets {
        process_result_set_rows(rows, &output_names, &mut result_sets, &mut rows_affected, &mut output_params);
    }

    Ok(serde_json::json!({
        "rowsAffected": rows_affected,
        "resultSets": result_sets,
        "outputParams": output_params,
    })
    .to_string())
}

fn process_result_set_rows(
    rows: Vec<serde_json::Value>,
    output_names: &[String],
    result_sets: &mut Vec<Vec<serde_json::Value>>,
    rows_affected: &mut i64,
    output_params: &mut serde_json::Map<String, serde_json::Value>,
) {
    let mut current_set = Vec::new();
    for json in rows {
        // Check for __rc sentinel
        if let Some(rc) = json.get("__rc") {
            if let Some(n) = rc.as_i64() {
                *rows_affected = n;
                continue;
            }
        }
        // Check for output params
        if !output_names.is_empty() {
            if let Some(obj) = json.as_object() {
                let is_output_row = output_names.iter().all(|n| obj.contains_key(n));
                if is_output_row && obj.len() == output_names.len() {
                    for (k, v) in obj {
                        output_params.insert(k.clone(), v.clone());
                    }
                    continue;
                }
            }
        }
        current_set.push(json);
    }
    if !current_set.is_empty() {
        result_sets.push(current_set);
    }
}

/// Execute a query and return all rows as JSON values for streaming.
pub fn execute_query_stream(
    conn: &Connection<'static>,
    cmd: &SerializedCommand,
) -> Result<Vec<serde_json::Value>> {
    let sql = build_sql_with_params(cmd)?;

    match conn.execute(&sql, ()).map_err(MssqlError::from)? {
        Some(cursor) => cursor_to_json_rows(cursor),
        None => Ok(vec![]),
    }
}

/// Execute a simple SQL statement (no result set expected).
/// Used for transactions (BEGIN/COMMIT/ROLLBACK).
pub fn simple_execute(conn: &Connection<'static>, sql: &str) -> Result<()> {
    conn.execute(sql, ()).map_err(MssqlError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn param(name: &str) -> SerializedParam {
        SerializedParam {
            name: name.to_string(),
            value: serde_json::Value::Null,
            param_type: None,
            output: false,
        }
    }

    #[test]
    fn no_params_returns_unchanged() {
        let (sql, order) = rewrite_named_params("SELECT * FROM t", &[]);
        assert_eq!(sql, "SELECT * FROM t");
        assert!(order.is_empty());
    }

    #[test]
    fn rewrite_single_param() {
        let params = vec![param("name")];
        let (sql, order) = rewrite_named_params("SELECT * FROM t WHERE name = @name", &params);
        assert_eq!(sql, "SELECT * FROM t WHERE name = @P1");
        assert_eq!(order, vec![0]);
    }

    #[test]
    fn rewrite_multiple_params() {
        let params = vec![param("a"), param("b")];
        let (sql, order) = rewrite_named_params("SELECT @a, @b", &params);
        assert_eq!(sql, "SELECT @P1, @P2");
        assert_eq!(order, vec![0, 1]);
    }

    #[test]
    fn preserves_string_literals() {
        let params = vec![param("name")];
        let (sql, _) = rewrite_named_params("SELECT '@name', @name", &params);
        assert_eq!(sql, "SELECT '@name', @P1");
    }

    #[test]
    fn preserves_system_variables() {
        let params = vec![param("val")];
        let (sql, _) = rewrite_named_params("SELECT @@IDENTITY, @val", &params);
        assert_eq!(sql, "SELECT @@IDENTITY, @P1");
    }

    #[test]
    fn case_insensitive_matching() {
        let params = vec![param("Name")];
        let (sql, order) = rewrite_named_params("SELECT @name, @NAME", &params);
        assert_eq!(sql, "SELECT @P1, @P2");
        assert_eq!(order, vec![0, 0]);
    }

    #[test]
    fn rewrite_repeated_param() {
        let params = vec![param("x")];
        let (sql, order) = rewrite_named_params("@x + @x", &params);
        assert_eq!(sql, "@P1 + @P2");
        assert_eq!(order, vec![0, 0]);
    }

    #[test]
    fn sql_type_declares() {
        assert_eq!(sql_type_for_declare("int").unwrap(), "INT");
        assert_eq!(sql_type_for_declare("BIGINT").unwrap(), "BIGINT");
        assert_eq!(sql_type_for_declare("nvarchar").unwrap(), "NVARCHAR(MAX)");
        assert_eq!(
            sql_type_for_declare("uniqueidentifier").unwrap(),
            "UNIQUEIDENTIFIER"
        );
        assert!(sql_type_for_declare("badtype").is_err());
    }
}
