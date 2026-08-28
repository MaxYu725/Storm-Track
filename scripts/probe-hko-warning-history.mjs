const origin = 'https://www.hko.gov.hk';
const dataUrl = `${origin}/dps/wxinfo/climat/warndb/tc.dat`;
const namesUrl = `${origin}/dps/wxinfo/climat/warndb/tcname.dat`;

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Storm-Track-HKO-Truth-Audit/1.0',
      accept: 'text/plain,*/*'
    },
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return { response, text };
}

const [{ response, text }, names] = await Promise.all([
  fetchText(dataUrl),
  fetchText(namesUrl)
]);
const lines = text.split(/\r?\n/).filter(Boolean);
const recentLines = lines.filter(line => /\t2026(?:\t|$)/.test(line) || line.includes('UUUU'));
const august2026 = lines.filter(line => {
  const fields = line.split(/\t/);
  return fields[8] === '2026' && String(fields[7]).padStart(2, '0') === '08'
    || fields[13] === '2026' && String(fields[12]).padStart(2, '0') === '08';
});
const nameLines = names.text.split(/\r?\n/).filter(Boolean).slice(-30);

console.log(JSON.stringify({
  dataUrl,
  status: response.status,
  contentType: response.headers.get('content-type'),
  bytes: Buffer.byteLength(text),
  lineCount: lines.length,
  recentLines: recentLines.slice(-80),
  august2026,
  recentNameLines: nameLines
}, null, 2));
