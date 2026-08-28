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

const scriptTags = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(match => {
  const attrs = match[1] || '';
  const src = attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1] || null;
  const inline = (match[2] || '').replace(/\s+/g, ' ').trim();
  return { src, inline: inline.slice(0, 5000) };
});
const relevantHtml = [...text.matchAll(/.{0,500}(?:warningsearch|result_content|selType|startdate|enddate).{0,1500}/gis)]
  .map(match => match[0].replace(/\s+/g, ' ').slice(0, 2500));

console.log(JSON.stringify({
  requestedUrl: url.toString(),
  status: response.status,
  contentType: response.headers.get('content-type'),
  bytes: Buffer.byteLength(text),
  scriptTags,
  relevantHtml
}, null, 2));
