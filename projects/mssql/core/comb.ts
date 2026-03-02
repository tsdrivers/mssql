/**
 * Generate a COMB (Combined GUID/Timestamp) UUID.
 *
 * COMB UUIDs replace the last 6 bytes of a v4 UUID with a timestamp,
 * producing UUIDs that are sequential over time. This dramatically
 * improves INSERT performance and reduces index fragmentation in
 * SQL Server's clustered UNIQUEIDENTIFIER indexes.
 *
 * SQL Server sorts GUIDs by the last 6 bytes first (bytes 10-15),
 * so the timestamp is placed there for correct sort ordering.
 *
 * @see https://www.informit.com/articles/article.aspx?p=25862&seqNum=7
 * @returns A COMB UUID string in standard format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 */
export function newCOMB(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set version 4 bits (byte 6, high nibble = 0100)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Set variant bits (byte 8, high bits = 10)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  // Encode timestamp into the last 6 bytes (bytes 10-15).
  // SQL Server sorts UUIDs by these bytes first, so placing
  // the timestamp here ensures chronological ordering.
  const now = Date.now();
  bytes[10] = (now / 2 ** 40) & 0xff;
  bytes[11] = (now / 2 ** 32) & 0xff;
  bytes[12] = (now / 2 ** 24) & 0xff;
  bytes[13] = (now / 2 ** 16) & 0xff;
  bytes[14] = (now / 2 ** 8) & 0xff;
  bytes[15] = now & 0xff;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
