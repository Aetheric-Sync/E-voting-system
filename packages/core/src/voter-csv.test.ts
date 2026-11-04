import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVoterCsv } from './voter-csv';

test('parses rows with and without a header, normalising ids', () => {
  const withHeader = parseVoterCsv('id,name,email,phone\nCSC/21/001,Ada Obi,ADA@x.com,\nCSC/21/002,"Bello, Musa",,+234 803 000 1111');
  assert.deepEqual(withHeader.errors, []);
  assert.deepEqual(withHeader.voters, [
    { id: 'csc/21/001', name: 'Ada Obi', email: 'ada@x.com' },
    { id: 'csc/21/002', name: 'Bello, Musa', phone: '+2348030001111' },
  ]);
  const noHeader = parseVoterCsv('v1,Ann,ann@x.com');
  assert.equal(noHeader.voters.length, 1);
});

test('reports bad rows by line and keeps the good ones', () => {
  const r = parseVoterCsv(
    ['id,name,email,phone', 'a1,Ann,ann@x.com', ',NoId,n@x.com', 'a2,,b@x.com', 'a3,Cy,notanemail', 'a4,Di', 'a1,Dup,d@x.com', 'a 5,Space,e@x.com', 'a6,Fay,,12'].join('\n'),
  );
  assert.deepEqual(r.voters.map((v) => v.id), ['a1']);
  assert.deepEqual(r.errors.map((e) => e.line), [3, 4, 5, 6, 7, 8, 9]);
});

test('empty input and BOM are handled', () => {
  assert.equal(parseVoterCsv('').errors.length, 1);
  assert.equal(parseVoterCsv('﻿id,name,email\nv1,A,a@x.com').voters.length, 1);
});

test('stops at the row limit', () => {
  const rows = Array.from({ length: 10 }, (_, i) => `v${i},N${i},n${i}@x.com`).join('\n');
  const r = parseVoterCsv(rows, 5);
  assert.equal(r.voters.length, 5);
  assert.match(r.errors[0].message, /Stopped/);
});
