// csv-reader-speed-01 solve.js — a fast, dependency-free reimplementation of
// csv-reader 1.0.0's readCsv. Bit-exact semantics; single pass, slicing fields
// instead of per-character concatenation.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // --- unquoted field reading ------------------------------------------------

  // Slow path (stray CR, or a non-empty prefix). Returns {value, ended, added}.
  function readUnquotedSlow(base) {
    let added = 0;
    let pieces = null;
    let start = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        let v;
        if (pieces === null) v = base + text.slice(start, pos);
        else { pieces.push(text.slice(start, pos)); v = pieces.join(''); }
        pos++;
        return { value: v, ended: COMMA, added };
      }
      if (c === 10) { // '\n'
        let v;
        if (pieces === null) v = base + text.slice(start, pos);
        else { pieces.push(text.slice(start, pos)); v = pieces.join(''); }
        pos++;
        line++;
        return { value: v, ended: LINE_BREAK, added };
      }
      if (c === 13) { // '\r'
        if (pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
          let v;
          if (pieces === null) v = base + text.slice(start, pos);
          else { pieces.push(text.slice(start, pos)); v = pieces.join(''); }
          pos += 2;
          line++;
          return { value: v, ended: LINE_BREAK, added };
        }
        // stray CR: dropped
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (pieces === null) pieces = [base];
        pieces.push(text.slice(start, pos));
        pos++;
        start = pos;
        continue;
      }
      added++;
      pos++;
    }
    let v;
    if (pieces === null) v = base + text.slice(start, pos);
    else { pieces.push(text.slice(start, pos)); v = pieces.join(''); }
    return { value: v, ended: END, added };
  }

  // Fast unquoted field. Returns {value, ended, added}.
  function readUnquoted(base) {
    const start = pos;
    let i = pos;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 44 || c === 10 || c === 13) break;
      i++;
    }
    if (i < len && text.charCodeAt(i) === 13 && !(i + 1 < len && text.charCodeAt(i + 1) === 10)) {
      // lone CR somewhere before the delimiter: fall back
      return readUnquotedSlow(base);
    }
    const value = base.length === 0 ? text.slice(start, i) : base + text.slice(start, i);
    const added = i - start;
    pos = i;
    if (i >= len) return { value, ended: END, added };
    const d = text.charCodeAt(i);
    if (d === 44) { pos = i + 1; return { value, ended: COMMA, added }; }
    if (d === 10) { pos = i + 1; line++; return { value, ended: LINE_BREAK, added }; }
    // '\r' followed by '\n'
    pos = i + 2;
    line++;
    return { value, ended: LINE_BREAK, added };
  }

  // --- quoted field reading --------------------------------------------------

  // What follows a closing quote (already consumed, pos points after it).
  function finishQuoted(value) {
    if (pos >= len) return { value, ended: END };
    const d = text.charCodeAt(pos);
    if (d === 44) { pos++; return { value, ended: COMMA }; }
    if (d === 10) { pos++; line++; return { value, ended: LINE_BREAK }; }
    if (d === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
      pos += 2; line++; return { value, ended: LINE_BREAK };
    }
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  function readQuotedSlow(open, openLine) {
    let pieces = null;
    let start = pos;
    let closed = false;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 34) { // '"'
        if (pos + 1 < len && text.charCodeAt(pos + 1) === 34) {
          if (pieces === null) pieces = [text.slice(start, pos)];
          else pieces.push(text.slice(start, pos));
          pieces.push('"');
          pos += 2;
          start = pos;
          continue;
        }
        if (pieces === null) var value = text.slice(start, pos);
        else { pieces.push(text.slice(start, pos)); var value = pieces.join(''); }
        pos++;
        closed = true;
        break;
      }
      if (c === 13) {
        if (pieces === null) pieces = [text.slice(start, pos)];
        else pieces.push(text.slice(start, pos));
        pieces.push('\n');
        line++;
        pos += (pos + 1 < len && text.charCodeAt(pos + 1) === 10) ? 2 : 1;
        start = pos;
        continue;
      }
      if (c === 10) {
        if (pieces === null) pieces = [text.slice(start, pos)];
        else pieces.push(text.slice(start, pos));
        pieces.push('\n');
        line++;
        pos++;
        start = pos;
        continue;
      }
      pos++;
    }
    if (!closed) {
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    return finishQuoted(value);
  }

  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos++;
    let i = pos;
    while (i < len) {
      const c = text.charCodeAt(i);
      if (c === 34 || c === 13 || c === 10) break;
      i++;
    }
    if (i >= len) {
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    const c = text.charCodeAt(i);
    if (c === 34 && !(i + 1 < len && text.charCodeAt(i + 1) === 34)) {
      const value = text.slice(pos, i);
      pos = i + 1;
      return finishQuoted(value);
    }
    return readQuotedSlow(open, openLine);
  }

  // --- main loop -------------------------------------------------------------

  while (true) {
    // Skip lines that have no characters.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    let ended;
    do {
      quoted = text.charCodeAt(pos) === 34;
      const f = quoted ? readQuoted() : readUnquoted('');
      fields.push(f.value);
      ended = f.ended;
    } while (ended === COMMA);

    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
