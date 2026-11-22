// csv-reader-speed-01 solve.js — a fast, dependency-free reimplementation of
// csv-reader 1.0.0's readCsv. Bit-exact semantics; single pass, slicing fields.
// No object allocation in the per-field hot path: field text is carried in a
// closure slot and a small integer reports how the field ended.

const COMMA = 0, LINE_BREAK = 1, END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  let fieldValue = '';   // the field being built / just finished
  let fieldAdded = 0;    // unquoted chars kept in this field (for quote_junk)

  // --- slow unquoted (stray CR present) -------------------------------------
  function readUnquotedSlow(base) {
    let added = 0;
    let pieces = null;
    let start = pos;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        let v;
        if (pieces === null) v = base + text.slice(start, pos);
        else { pieces.push(text.slice(start, pos)); v = pieces.join(''); }
        fieldValue = v; fieldAdded = added; pos++;
        return COMMA;
      }
      if (c === 10) {
        let v;
        if (pieces === null) v = base + text.slice(start, pos);
        else { pieces.push(text.slice(start, pos)); v = pieces.join(''); }
        fieldValue = v; fieldAdded = added; pos++; line++;
        return LINE_BREAK;
      }
      if (c === 13) {
        if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
          let v;
          if (pieces === null) v = base + text.slice(start, pos);
          else { pieces.push(text.slice(start, pos)); v = pieces.join(''); }
          fieldValue = v; fieldAdded = added; pos += 2; line++;
          return LINE_BREAK;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (pieces === null) pieces = [base];
        pieces.push(text.slice(start, pos));
        pos++; start = pos;
        continue;
      }
      added++; pos++;
    }
    let v;
    if (pieces === null) v = base + text.slice(start, pos);
    else { pieces.push(text.slice(start, pos)); v = pieces.join(''); }
    fieldValue = v; fieldAdded = added;
    return END;
  }

  // --- fast unquoted field --------------------------------------------------
  function readUnquoted(base) {
    const start = pos;
    let i = pos;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44 || c === 13 || c === 10) break;
      i++;
    }
    if (i < n && text.charCodeAt(i) === 13 && !(i + 1 < n && text.charCodeAt(i + 1) === 10)) {
      pos = start;
      return readUnquotedSlow(base);
    }
    const value = base === '' ? text.slice(start, i) : base + text.slice(start, i);
    const added = i - start;
    pos = i;
    if (i >= n) { fieldValue = value; fieldAdded = added; return END; }
    const d = text.charCodeAt(i);
    if (d === 44) { fieldValue = value; fieldAdded = added; pos = i + 1; return COMMA; }
    if (d === 10) { fieldValue = value; fieldAdded = added; pos = i + 1; line++; return LINE_BREAK; }
    // CR followed by LF
    fieldValue = value; fieldAdded = added; pos = i + 2; line++;
    return LINE_BREAK;
  }

  // --- quoted field ---------------------------------------------------------
  function finishQuoted(value) {
    if (pos >= n) { fieldValue = value; return END; }
    const d = text.charCodeAt(pos);
    if (d === 44) { fieldValue = value; pos++; return COMMA; }
    if (d === 10) { fieldValue = value; pos++; line++; return LINE_BREAK; }
    if (d === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      fieldValue = value; pos += 2; line++; return LINE_BREAK;
    }
    const ended = readUnquoted(value);
    if (fieldAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return ended;
  }

  function readQuotedSlow(open, openLine) {
    let pieces = null;
    let start = pos;
    let closed = false;
    let value;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 34) {
        if (pos + 1 < n && text.charCodeAt(pos + 1) === 34) {
          if (pieces === null) pieces = [text.slice(start, pos)];
          else pieces.push(text.slice(start, pos));
          pieces.push('"');
          pos += 2; start = pos;
          continue;
        }
        if (pieces === null) value = text.slice(start, pos);
        else { pieces.push(text.slice(start, pos)); value = pieces.join(''); }
        pos++; closed = true;
        break;
      }
      if (c === 13) {
        if (pieces === null) pieces = [text.slice(start, pos)];
        else pieces.push(text.slice(start, pos));
        pieces.push('\n');
        line++;
        pos += (pos + 1 < n && text.charCodeAt(pos + 1) === 10) ? 2 : 1;
        start = pos;
        continue;
      }
      if (c === 10) {
        if (pieces === null) pieces = [text.slice(start, pos)];
        else pieces.push(text.slice(start, pos));
        pieces.push('\n');
        line++;
        pos++; start = pos;
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
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34 || c === 13 || c === 10) break;
      i++;
    }
    if (i >= n) {
      pos = open + 1; line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    const c = text.charCodeAt(i);
    if (c === 34 && !(i + 1 < n && text.charCodeAt(i + 1) === 34)) {
      const value = text.slice(pos, i);
      pos = i + 1;
      return finishQuoted(value);
    }
    return readQuotedSlow(open, openLine);
  }

  // --- main loop -------------------------------------------------------------
  while (true) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended;
    do {
      quoted = text.charCodeAt(pos) === 34;
      ended = quoted ? readQuoted() : readUnquoted('');
      fields.push(fieldValue);
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
