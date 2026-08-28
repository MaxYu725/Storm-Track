const month = process.env.HKO_WARNDB_MONTH || '202608';
const url = new URL('https://www.hko.gov.hk/en/wxinfo/climat/warndb/warndb1.shtml');
url.searchParams.set('opt', '1');
url.searchParams.set('sgnl', '1.or.higher');
url.searchParams.set('start_ym', month);
url.searchParams.set('end_ym', month);
url.searchParams.set('submit', 'Submit Query');

const response = await fetch(url, {
  headers: {
    'user-agent': 'Storm-Track-HKO-Truth-Audit/1.0',
    accept: 'text/html,application/xhtml+xml'
  },
  signal: AbortSignal.timeout(20000)
});
const text = await response.text();
if (!response.ok) throw new Error(`HKO warning history HTTP ${response.status}`);

const normalized = text
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/\s+/g, ' ');

console.log(JSON.stringify({
  requestedUrl: url.toString(),
  status: response.status,
  contentType: response.headers.get('content-type'),
  bytes: Buffer.byteLength(text),
  has2026: /2026/.test(text),
  hasNo1: /(?:No\.?\s*1|Signal\s*No\.?\s*1|Standby)/i.test(text),
  tableCount: (text.match(/<table\b/gi) || []).length,
  rowCount: (text.match(/<tr\b/gi) || []).length,
  sample: normalized.slice(0, 18000)
}, null, 2));
