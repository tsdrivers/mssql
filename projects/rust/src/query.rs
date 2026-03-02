use std::collections::HashMap;

use mssql_client::{Client, Ready, Row, SqlValue, ToSql};
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

// ── Parameter conversion ──────────────────────────────────────

/// Convert a SerializedParam to a boxed ToSql value for parameterized queries.
pub fn param_to_boxed(param: &SerializedParam) -> Result<Box<dyn ToSql + Sync>> {
    match &param.value {
        serde_json::Value::Null => Ok(Box::new(Option::<String>::None)),
        serde_json::Value::Bool(b) => Ok(Box::new(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                match param.param_type.as_deref() {
                    Some("tinyint") => Ok(Box::new(i as u8)),
                    Some("smallint") => Ok(Box::new(i as i16)),
                    Some("int") => Ok(Box::new(i as i32)),
                    Some("bigint") => Ok(Box::new(i)),
                    Some("float") | Some("real") => Ok(Box::new(i as f64)),
                    _ => {
                        if (i32::MIN as i64..=i32::MAX as i64).contains(&i) {
                            Ok(Box::new(i as i32))
                        } else {
                            Ok(Box::new(i))
                        }
                    }
                }
            } else if let Some(f) = n.as_f64() {
                Ok(Box::new(f))
            } else {
                Err(MssqlError::Query(format!("Unsupported number: {n}")))
            }
        }
        serde_json::Value::String(s) => {
            match param.param_type.as_deref() {
                Some("uniqueidentifier") => {
                    let uuid: uuid::Uuid = s
                        .parse()
                        .map_err(|e| MssqlError::Query(format!("Invalid UUID: {e}")))?;
                    Ok(Box::new(uuid))
                }
                Some("date") => {
                    let d: chrono::NaiveDate = s
                        .parse()
                        .map_err(|e| MssqlError::Query(format!("Invalid date: {e}")))?;
                    Ok(Box::new(d))
                }
                Some("time") => {
                    let t: chrono::NaiveTime = s
                        .parse()
                        .map_err(|e| MssqlError::Query(format!("Invalid time: {e}")))?;
                    Ok(Box::new(t))
                }
                Some("datetime" | "datetime2") => {
                    let dt = parse_datetime(s)?;
                    Ok(Box::new(dt))
                }
                Some("datetimeoffset") => {
                    let dt: chrono::DateTime<chrono::FixedOffset> = s
                        .parse()
                        .map_err(|e| MssqlError::Query(format!("Invalid datetimeoffset: {e}")))?;
                    Ok(Box::new(dt))
                }
                Some("varbinary") => {
                    let bytes = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        s,
                    )
                    .map_err(|e| MssqlError::Query(format!("Invalid base64: {e}")))?;
                    Ok(Box::new(bytes))
                }
                _ => Ok(Box::new(s.clone())),
            }
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            Ok(Box::new(serde_json::to_string(&param.value).unwrap()))
        }
    }
}

/// Convert a SerializedParam to an SqlValue for literal embedding
/// (used in OUTPUT param batches where we can't use parameterized queries).
pub fn param_to_sql_value(param: &SerializedParam) -> Result<SqlValue> {
    match &param.value {
        serde_json::Value::Null => Ok(SqlValue::Null),
        serde_json::Value::Bool(b) => Ok(SqlValue::Bool(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                match param.param_type.as_deref() {
                    Some("tinyint") => Ok(SqlValue::TinyInt(i as u8)),
                    Some("smallint") => Ok(SqlValue::SmallInt(i as i16)),
                    Some("int") => Ok(SqlValue::Int(i as i32)),
                    Some("bigint") => Ok(SqlValue::BigInt(i)),
                    Some("float") | Some("real") => Ok(SqlValue::Double(i as f64)),
                    _ => {
                        if (i32::MIN as i64..=i32::MAX as i64).contains(&i) {
                            Ok(SqlValue::Int(i as i32))
                        } else {
                            Ok(SqlValue::BigInt(i))
                        }
                    }
                }
            } else if let Some(f) = n.as_f64() {
                Ok(SqlValue::Double(f))
            } else {
                Err(MssqlError::Query(format!("Unsupported number: {n}")))
            }
        }
        serde_json::Value::String(s) => {
            match param.param_type.as_deref() {
                Some("uniqueidentifier") => {
                    let uuid: uuid::Uuid = s
                        .parse()
                        .map_err(|e| MssqlError::Query(format!("Invalid UUID: {e}")))?;
                    Ok(SqlValue::Uuid(uuid))
                }
                Some("date") => {
                    let d: chrono::NaiveDate = s
                        .parse()
                        .map_err(|e| MssqlError::Query(format!("Invalid date: {e}")))?;
                    Ok(SqlValue::Date(d))
                }
                Some("time") => {
                    let t: chrono::NaiveTime = s
                        .parse()
                        .map_err(|e| MssqlError::Query(format!("Invalid time: {e}")))?;
                    Ok(SqlValue::Time(t))
                }
                Some("datetime" | "datetime2") => {
                    let dt = parse_datetime(s)?;
                    Ok(SqlValue::DateTime(dt))
                }
                Some("datetimeoffset") => {
                    let dt: chrono::DateTime<chrono::FixedOffset> = s
                        .parse()
                        .map_err(|e| MssqlError::Query(format!("Invalid datetimeoffset: {e}")))?;
                    Ok(SqlValue::DateTimeOffset(dt))
                }
                Some("varbinary") => {
                    let bytes = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        s,
                    )
                    .map_err(|e| MssqlError::Query(format!("Invalid base64: {e}")))?;
                    Ok(SqlValue::Binary(bytes.into()))
                }
                _ => Ok(SqlValue::String(s.clone())),
            }
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            Ok(SqlValue::String(serde_json::to_string(&param.value).unwrap()))
        }
    }
}

fn parse_datetime(s: &str) -> Result<chrono::NaiveDateTime> {
    // Try ISO 8601 first, then common SQL Server formats
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f") {
        return Ok(dt);
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Ok(dt);
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f") {
        return Ok(dt);
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
        return Ok(dt);
    }
    // Try parsing as DateTime<FixedOffset> and strip timezone
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Ok(dt.naive_utc());
    }
    Err(MssqlError::Query(format!("Invalid datetime: {s}")))
}

// ── SQL literal conversion (for OUTPUT param batches) ─────────

/// Convert an SqlValue to a SQL literal string for embedding in
/// simple_query batches (OUTPUT params, etc.).
pub fn sql_value_to_literal(val: &SqlValue) -> String {
    match val {
        SqlValue::Null => "NULL".to_string(),
        SqlValue::Bool(b) => if *b { "1" } else { "0" }.to_string(),
        SqlValue::TinyInt(n) => n.to_string(),
        SqlValue::SmallInt(n) => n.to_string(),
        SqlValue::Int(n) => n.to_string(),
        SqlValue::BigInt(n) => n.to_string(),
        SqlValue::Float(n) => {
            if n.is_nan() || n.is_infinite() { "NULL".to_string() }
            else { n.to_string() }
        }
        SqlValue::Double(n) => {
            if n.is_nan() || n.is_infinite() { "NULL".to_string() }
            else { n.to_string() }
        }
        SqlValue::String(s) => format!("N'{}'", s.replace('\'', "''")),
        SqlValue::Binary(bytes) => {
            let hex: String = bytes.iter().map(|b| format!("{b:02X}")).collect();
            format!("0x{hex}")
        }
        SqlValue::Uuid(u) => format!("'{u}'"),
        SqlValue::Date(d) => format!("'{d}'"),
        SqlValue::Time(t) => format!("'{t}'"),
        SqlValue::DateTime(dt) => format!("'{dt}'"),
        SqlValue::DateTimeOffset(dt) => format!("'{dt}'"),
        _ => "NULL".to_string(),
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

// ── Row to JSON conversion ────────────────────────────────────

/// Convert a Row from mssql-client to a JSON object.
pub fn row_to_json(row: &Row) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for col in row.columns() {
        let value = match row.get_raw(col.index) {
            None | Some(SqlValue::Null) => serde_json::Value::Null,
            Some(SqlValue::Bool(b)) => serde_json::Value::Bool(b),
            Some(SqlValue::TinyInt(n)) => serde_json::json!(n),
            Some(SqlValue::SmallInt(n)) => serde_json::json!(n),
            Some(SqlValue::Int(n)) => serde_json::json!(n),
            Some(SqlValue::BigInt(n)) => {
                // JavaScript safe integer range
                if (-(1i64 << 53)..=(1i64 << 53)).contains(&n) {
                    serde_json::json!(n)
                } else {
                    serde_json::Value::String(n.to_string())
                }
            }
            Some(SqlValue::Float(n)) => serde_json::json!(n),
            Some(SqlValue::Double(n)) => serde_json::json!(n),
            Some(SqlValue::String(s)) => serde_json::Value::String(s),
            Some(SqlValue::Binary(bytes)) => {
                serde_json::Value::String(
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes),
                )
            }
            Some(SqlValue::Uuid(u)) => serde_json::Value::String(u.to_string()),
            Some(SqlValue::Date(d)) => serde_json::Value::String(d.to_string()),
            Some(SqlValue::Time(t)) => serde_json::Value::String(t.to_string()),
            Some(SqlValue::DateTime(dt)) => serde_json::Value::String(dt.to_string()),
            Some(SqlValue::DateTimeOffset(dt)) => {
                serde_json::Value::String(dt.to_rfc3339())
            }
            Some(SqlValue::Xml(s)) => serde_json::Value::String(s),
            Some(other) => serde_json::Value::String(format!("{other:?}")),
        };
        map.insert(col.name.clone(), value);
    }
    serde_json::Value::Object(map)
}

// ── Query execution ───────────────────────────────────────────

/// Execute a query and return a JSON array of rows.
pub async fn execute_query(
    client: &mut Client<Ready>,
    cmd: &SerializedCommand,
) -> Result<String> {
    let (rewritten_sql, order) = rewrite_named_params(&cmd.sql, &cmd.params);
    let owned_values = build_param_boxes(&cmd.params, &order)?;
    let param_refs: Vec<&(dyn ToSql + Sync)> = owned_values
        .iter()
        .map(|v| &**v as &(dyn ToSql + Sync))
        .collect();

    let stream = if param_refs.is_empty() {
        client.query(&cmd.sql, &[]).await
    } else {
        client.query(&rewritten_sql, &param_refs).await
    }
    .map_err(MssqlError::from)?;

    let mut rows_json = Vec::new();
    for result in stream {
        let row: Row = result.map_err(MssqlError::from)?;
        rows_json.push(row_to_json(&row));
    }

    Ok(serde_json::to_string(&rows_json).unwrap())
}

/// Execute a non-query and return JSON { rowsAffected }.
pub async fn execute_nonquery(
    client: &mut Client<Ready>,
    cmd: &SerializedCommand,
) -> Result<String> {
    let (rewritten_sql, order) = rewrite_named_params(&cmd.sql, &cmd.params);
    let owned_values = build_param_boxes(&cmd.params, &order)?;
    let param_refs: Vec<&(dyn ToSql + Sync)> = owned_values
        .iter()
        .map(|v| &**v as &(dyn ToSql + Sync))
        .collect();

    let rows_affected = if param_refs.is_empty() {
        client.execute(&cmd.sql, &[]).await
    } else {
        client.execute(&rewritten_sql, &param_refs).await
    }
    .map_err(MssqlError::from)?;

    Ok(serde_json::json!({ "rowsAffected": rows_affected }).to_string())
}

/// Execute a stored procedure or complex query and return JSON with
/// result sets, rows affected, and output parameters.
pub async fn execute_exec(
    client: &mut Client<Ready>,
    cmd: &SerializedCommand,
) -> Result<String> {
    let has_output = cmd.params.iter().any(|p| p.output);

    if has_output {
        execute_exec_with_output(client, cmd).await
    } else {
        execute_exec_simple(client, cmd).await
    }
}

/// exec without OUTPUT params — use query_multiple to collect result sets.
async fn execute_exec_simple(
    client: &mut Client<Ready>,
    cmd: &SerializedCommand,
) -> Result<String> {
    let (rewritten_sql, order) = rewrite_named_params(&cmd.sql, &cmd.params);
    let owned_values = build_param_boxes(&cmd.params, &order)?;
    let param_refs: Vec<&(dyn ToSql + Sync)> = owned_values
        .iter()
        .map(|v| &**v as &(dyn ToSql + Sync))
        .collect();

    // Append SELECT @@ROWCOUNT to capture rows affected
    let sql_with_rc = if param_refs.is_empty() {
        format!("{}; SELECT @@ROWCOUNT AS __rc", cmd.sql)
    } else {
        format!("{rewritten_sql}; SELECT @@ROWCOUNT AS __rc")
    };

    let mut multi = client
        .query_multiple(&sql_with_rc, &param_refs)
        .await
        .map_err(MssqlError::from)?;

    let mut result_sets: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut rows_affected: i64 = 0;

    loop {
        let mut current_set = Vec::new();
        while let Some(row) = multi.next_row().await.map_err(MssqlError::from)? {
            let json = row_to_json(&row);
            // Check if this is the __rc sentinel
            if let Some(rc) = json.get("__rc") {
                if let Some(n) = rc.as_i64() {
                    rows_affected = n;
                    continue;
                }
            }
            current_set.push(json);
        }
        if !current_set.is_empty() {
            result_sets.push(current_set);
        }
        if !multi.next_result().await.map_err(MssqlError::from)? {
            break;
        }
    }

    Ok(serde_json::json!({
        "rowsAffected": rows_affected,
        "resultSets": result_sets,
        "outputParams": {},
    })
    .to_string())
}

/// exec with OUTPUT params — build a simple_query batch.
async fn execute_exec_with_output(
    client: &mut Client<Ready>,
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
                let val = param_to_sql_value(param)?;
                batch.push_str(&format!("SET @{clean} = {};\n", sql_value_to_literal(&val)));
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
                let val = param_to_sql_value(param)?;
                param_parts.push(format!("@{clean} = {}", sql_value_to_literal(&val)));
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
    let mut multi = client
        .query_multiple(&batch, &[])
        .await
        .map_err(MssqlError::from)?;

    let mut result_sets: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut rows_affected: i64 = 0;
    let mut output_params = serde_json::Map::new();

    loop {
        let mut current_set = Vec::new();
        while let Some(row) = multi.next_row().await.map_err(MssqlError::from)? {
            let json = row_to_json(&row);
            // Check for __rc sentinel
            if let Some(rc) = json.get("__rc") {
                if let Some(n) = rc.as_i64() {
                    rows_affected = n;
                    continue;
                }
            }
            // Check for output params (columns match output_names)
            if !output_names.is_empty() {
                let obj = json.as_object().unwrap();
                let is_output_row = output_names
                    .iter()
                    .all(|n| obj.contains_key(n));
                if is_output_row && obj.len() == output_names.len() {
                    for (k, v) in obj {
                        output_params.insert(k.clone(), v.clone());
                    }
                    continue;
                }
            }
            current_set.push(json);
        }
        if !current_set.is_empty() {
            result_sets.push(current_set);
        }
        if !multi.next_result().await.map_err(MssqlError::from)? {
            break;
        }
    }

    Ok(serde_json::json!({
        "rowsAffected": rows_affected,
        "resultSets": result_sets,
        "outputParams": output_params,
    })
    .to_string())
}

/// Execute a query and return all rows for streaming.
pub async fn execute_query_stream(
    client: &mut Client<Ready>,
    cmd: &SerializedCommand,
) -> Result<Vec<Row>> {
    let (rewritten_sql, order) = rewrite_named_params(&cmd.sql, &cmd.params);
    let owned_values = build_param_boxes(&cmd.params, &order)?;
    let param_refs: Vec<&(dyn ToSql + Sync)> = owned_values
        .iter()
        .map(|v| &**v as &(dyn ToSql + Sync))
        .collect();

    let stream = if param_refs.is_empty() {
        client.query(&cmd.sql, &[]).await
    } else {
        client.query(&rewritten_sql, &param_refs).await
    }
    .map_err(MssqlError::from)?;

    let mut rows = Vec::new();
    for result in stream {
        let row: Row = result.map_err(MssqlError::from)?;
        rows.push(row);
    }
    Ok(rows)
}

// ── Helpers ───────────────────────────────────────────────────

fn build_param_boxes(
    params: &[SerializedParam],
    order: &[usize],
) -> Result<Vec<Box<dyn ToSql + Sync>>> {
    let mut all_values: Vec<Box<dyn ToSql + Sync>> = Vec::with_capacity(params.len());
    for param in params {
        all_values.push(param_to_boxed(param)?);
    }
    // Reorder according to the named-param mapping.
    // We need to rebuild from params since Box isn't Clone.
    let mut ordered: Vec<Box<dyn ToSql + Sync>> = Vec::with_capacity(order.len());
    for &idx in order {
        ordered.push(param_to_boxed(&params[idx])?);
    }
    // Drop unused all_values
    drop(all_values);
    Ok(ordered)
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
