use mssql_client::{Client, Ready};
use serde::Deserialize;

use crate::debug::debug_log;
use crate::error::{MssqlError, Result};

/// Default batch size for INSERT batches.
const DEFAULT_BATCH_SIZE: usize = 1000;

#[derive(Deserialize)]
pub struct BulkInsertRequest {
    pub table: String,
    pub columns: Vec<BulkColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    #[serde(default)]
    pub batch_size: Option<usize>,
}

#[derive(Deserialize)]
pub struct BulkColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub col_type: String,
    #[serde(default)]
    #[allow(dead_code)] // Deserialized from JSON but not used in Rust
    pub nullable: bool,
}

/// Execute a bulk insert using batched INSERT ... VALUES statements.
///
/// mssql-client v0.6's BulkInsert API only generates TDS packets without
/// a way to send them through Client, so we use standard INSERT batches.
/// This is reliable and works for all scenarios, though slightly slower
/// than the native TDS bulk copy protocol for very large datasets.
pub async fn execute_bulk(
    client: &mut Client<Ready>,
    req: &BulkInsertRequest,
) -> Result<u64> {
    if req.rows.is_empty() {
        return Ok(0);
    }

    let batch_size = req.batch_size.unwrap_or(DEFAULT_BATCH_SIZE).max(1);
    let col_names: Vec<&str> = req.columns.iter().map(|c| c.name.as_str()).collect();

    debug_log!(
        "Bulk insert: table={}, columns={}, rows={}, batch_size={}",
        req.table,
        col_names.len(),
        req.rows.len(),
        batch_size
    );

    let mut total_affected: u64 = 0;

    for chunk in req.rows.chunks(batch_size) {
        let sql = build_insert_batch(&req.table, &col_names, &req.columns, chunk)?;

        let affected = client
            .execute(&sql, &[])
            .await
            .map_err(|e| MssqlError::Query(format!("Bulk insert batch failed: {e}")))?;

        total_affected += affected as u64;
    }

    debug_log!("Bulk insert complete: {} rows affected", total_affected);
    Ok(total_affected)
}

/// Build a single INSERT ... VALUES (...), (...), ... statement for a batch.
fn build_insert_batch(
    table: &str,
    col_names: &[&str],
    columns: &[BulkColumn],
    rows: &[Vec<serde_json::Value>],
) -> Result<String> {
    let mut sql = String::with_capacity(rows.len() * 100);

    // Escape table name (bracket-quoted)
    sql.push_str("INSERT INTO ");
    sql.push_str(&bracket_escape(table));
    sql.push_str(" (");
    for (i, name) in col_names.iter().enumerate() {
        if i > 0 {
            sql.push_str(", ");
        }
        sql.push_str(&bracket_escape(name));
    }
    sql.push_str(") VALUES ");

    for (row_idx, row_data) in rows.iter().enumerate() {
        if row_idx > 0 {
            sql.push_str(", ");
        }
        sql.push('(');

        for (col_idx, value) in row_data.iter().enumerate() {
            if col_idx > 0 {
                sql.push_str(", ");
            }
            let col = columns.get(col_idx).ok_or_else(|| {
                MssqlError::Query(format!(
                    "Row has {} values but only {} columns defined",
                    row_data.len(),
                    columns.len()
                ))
            })?;
            sql.push_str(&value_to_literal(value, &col.col_type)?);
        }
        sql.push(')');
    }

    Ok(sql)
}

/// Convert a JSON value to a SQL literal string for embedding in INSERT statements.
fn value_to_literal(value: &serde_json::Value, col_type: &str) -> Result<String> {
    match value {
        serde_json::Value::Null => Ok("NULL".to_string()),
        serde_json::Value::Bool(b) => Ok(if *b { "1" } else { "0" }.to_string()),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        serde_json::Value::String(s) => {
            match col_type {
                "uniqueidentifier" => {
                    // Validate UUID format
                    uuid::Uuid::parse_str(s)
                        .map_err(|e| MssqlError::Query(format!("Invalid UUID: {e}")))?;
                    Ok(format!("'{s}'"))
                }
                "varbinary" | "binary" | "image" => {
                    use base64::Engine;
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(s)
                        .map_err(|e| MssqlError::Query(format!("Invalid base64: {e}")))?;
                    let hex: String = bytes.iter().map(|b| format!("{b:02X}")).collect();
                    Ok(format!("0x{hex}"))
                }
                _ => {
                    // Escape single quotes for string literal
                    Ok(format!("N'{}'", s.replace('\'', "''")))
                }
            }
        }
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            let json_str = serde_json::to_string(value)
                .map_err(|e| MssqlError::Query(e.to_string()))?;
            Ok(format!("N'{}'", json_str.replace('\'', "''")))
        }
    }
}

/// Bracket-escape a SQL identifier.
fn bracket_escape(name: &str) -> String {
    // Remove existing brackets and re-wrap
    let clean = name.trim_start_matches('[').trim_end_matches(']');
    format!("[{}]", clean.replace(']', "]]"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bracket_escape() {
        assert_eq!(bracket_escape("TableName"), "[TableName]");
        assert_eq!(bracket_escape("[Already]"), "[Already]");
        assert_eq!(bracket_escape("has]bracket"), "[has]]bracket]");
    }

    #[test]
    fn test_value_to_literal() {
        assert_eq!(
            value_to_literal(&serde_json::Value::Null, "int").unwrap(),
            "NULL"
        );
        assert_eq!(
            value_to_literal(&serde_json::json!(42), "int").unwrap(),
            "42"
        );
        assert_eq!(
            value_to_literal(&serde_json::json!(true), "bit").unwrap(),
            "1"
        );
        assert_eq!(
            value_to_literal(&serde_json::json!("hello"), "nvarchar").unwrap(),
            "N'hello'"
        );
        assert_eq!(
            value_to_literal(&serde_json::json!("it's"), "varchar").unwrap(),
            "N'it''s'"
        );
    }

    #[test]
    fn test_build_insert_batch() {
        let columns = vec![
            BulkColumn { name: "id".into(), col_type: "int".into(), nullable: false },
            BulkColumn { name: "name".into(), col_type: "nvarchar".into(), nullable: true },
        ];
        let col_names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
        let rows = vec![
            vec![serde_json::json!(1), serde_json::json!("Alice")],
            vec![serde_json::json!(2), serde_json::json!("Bob")],
        ];
        let sql = build_insert_batch("Users", &col_names, &columns, &rows).unwrap();
        assert_eq!(
            sql,
            "INSERT INTO [Users] ([id], [name]) VALUES (1, N'Alice'), (2, N'Bob')"
        );
    }
}
