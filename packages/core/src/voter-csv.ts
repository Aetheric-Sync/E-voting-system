export interface VoterRow {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

export interface CsvError {
  line: number;
  message: string;
}

export interface ParsedRegister {
  voters: VoterRow[];
  errors: CsvError[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{7,15}$/;

/** Split one CSV record, honouring double quotes and "" escapes. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Voter ids are case-insensitive and may not contain spaces. */
export function normalizeVoterId(id: string): string {
  return id.trim().toLowerCase();
}

export function normalizePhone(p: string): string {
  return p.replace(/[\s()-]/g, '');
}

/**
 * Parse a voter register. Columns: id, name, email, phone. A header row is optional
 * (detected by a first cell of "id" / "matric" / "voter_id"). Every voter needs an id,
 * a name and at least one contact so a one-time code can be delivered.
 * Rows with problems are reported and skipped; the valid rows are still returned.
 */
export function parseVoterCsv(csv: string, maxRows = 200_000): ParsedRegister {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
  const voters: VoterRow[] = [];
  const errors: CsvError[] = [];
  const seen = new Set<string>();
  let start = 0;

  const firstNonEmpty = lines.findIndex((l) => l.trim());
  if (firstNonEmpty === -1) return { voters, errors: [{ line: 1, message: 'The file is empty' }] };
  const head = splitLine(lines[firstNonEmpty])[0].toLowerCase();
  if (['id', 'matric', 'voter_id', 'voterid', 'matric_number'].includes(head)) start = firstNonEmpty + 1;

  for (let i = start; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (voters.length + errors.length >= maxRows) {
      errors.push({ line: i + 1, message: `Stopped at ${maxRows} rows` });
      break;
    }
    const [rawId = '', name = '', rawEmail = '', rawPhone = ''] = splitLine(lines[i]);
    const line = i + 1;
    const id = normalizeVoterId(rawId);
    const email = rawEmail.trim().toLowerCase();
    const phone = normalizePhone(rawPhone);

    if (!id) errors.push({ line, message: 'Missing voter ID' });
    else if (/\s/.test(id)) errors.push({ line, message: `Voter ID "${id}" contains spaces` });
    else if (!name.trim()) errors.push({ line, message: `Missing name for ${id}` });
    else if (email && !EMAIL.test(email)) errors.push({ line, message: `Invalid email for ${id}` });
    else if (phone && !PHONE.test(phone)) errors.push({ line, message: `Invalid phone for ${id}` });
    else if (!email && !phone) errors.push({ line, message: `${id} needs an email or a phone number` });
    else if (seen.has(id)) errors.push({ line, message: `Duplicate voter ID ${id}` });
    else {
      seen.add(id);
      voters.push({ id, name: name.trim(), ...(email ? { email } : {}), ...(phone ? { phone } : {}) });
    }
  }
  return { voters, errors };
}
