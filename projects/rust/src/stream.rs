use std::collections::VecDeque;

use mssql_client::Row;

/// A buffered cursor for streaming query results row-by-row across FFI.
///
/// Unlike the tiberius driver which used an mpsc channel, mssql-client's
/// QueryStream buffers all rows upfront. We store the rows and column
/// metadata, then serialize to JSON one row at a time on each stream_next call.
pub struct RowCursor {
    rows: VecDeque<Row>,
    done: bool,
}

impl RowCursor {
    pub fn new(rows: Vec<Row>) -> Self {
        Self {
            rows: VecDeque::from(rows),
            done: false,
        }
    }

    /// Pop the next row, or None if exhausted.
    pub fn next_row(&mut self) -> Option<Row> {
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
