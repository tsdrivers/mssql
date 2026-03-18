use std::collections::VecDeque;

/// A buffered cursor for streaming query results row-by-row across FFI.
///
/// With the ODBC backend, rows are pre-serialized to JSON values during
/// query execution. The cursor stores these and returns them one at a time
/// via `next_row()`.
pub struct RowCursor {
    rows: VecDeque<serde_json::Value>,
    done: bool,
}

impl RowCursor {
    pub fn new(rows: Vec<serde_json::Value>) -> Self {
        Self {
            rows: VecDeque::from(rows),
            done: false,
        }
    }

    /// Pop the next row, or None if exhausted.
    pub fn next_row(&mut self) -> Option<serde_json::Value> {
        if self.done {
            return None;
        }
        match self.rows.pop_front() {
            Some(row) => Some(row),
            None => {
                self.done = true;
                None
            }
        }
    }
}
