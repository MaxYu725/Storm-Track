import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const JMA_BEST_TRACK_URL = 'https://www.jma.go.jp/jma/jma-eng/jma-center/rsmc-hp-pub-eg/Besttracks/bst2026.txt';
export const JMA_POSITION_TABLE_URL = 'https://www.data.jma.go.jp/typhoon/position_table/table2026.html';
export const TRUTH_SCHEMA_VERSION = 'jma-rsmc-finalized-truth/v1';

const GRADE = Object.freeze({
  2: 'TD', 3: 'TS', 4: 'STS', 5: 'TY', 6: 'EXTRATROPICAL', 7: 'ENTERING_RSMC_AREA', 9: 'TS_OR_HIGHER'
});

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function parseHeaderLine(line) {
  const tokens = String(line).trim().split(/\s+/);
  if (tokens[0] !== '66666' || !/^\d{4}$/.test(tokens[1] || '')) return null;
  const revisionDate = tokens.at(-1);
  if (!/^\d{8}$/.test(revisionDate || '')) throw new Error(`invalid JMA revision date in header: ${line}`);
  const dataLineCount = Number(tokens[2]);
  if (!Number.isInteger(dataLineCount) || dataLineCount < 1) throw new Error(`invalid JMA data-line count in header: ${line}`);
  return {
    internationalNumber: tokens[1],
    dataLineCount,
    cycloneNumber: tokens[3] ?? null,
    replicatedInternationalNumber: tokens[4] ?? null,
    lastLineFlag: Number(tokens[5]),
    finalAnalysisDifferenceHours: Number(tokens[6]),
    name: tokens.slice(7, -1).join(' ') || null,
    revisionDate
  };
}

function parseAnalysisTime(value) {
  if (!/^\d{8}$/.test(value || '')) throw new Error(`invalid JMA analysis time: ${value}`);
  const yy = Number(value.slice(0, 2));
  const year = yy >= 51 ? 1900 + yy : 2000 + yy;
  const month = value.slice(2, 4);
  const day = value.slice(4, 6);
  const hour = value.slice(6, 8);
  const iso = `${String(year).padStart(4, '0')}-${month}-${day}T${hour}:00:00.000Z`;
  if (!Number.isFinite(Date.parse(iso))) throw new Error(`invalid JMA analysis time: ${value}`);
  return iso;
}

function parseDataLine(line, internationalNumber) {
  const tokens = String(line).trim().split(/\s+/);
  if (tokens.length < 7 || tokens[1] !== '002') throw new Error(`invalid JMA best-track data line: ${line}`);
  const grade = Number(tokens[2]);
  const latTenths = Number(tokens[3]);
  const lonTenths = Number(tokens[4]);
  const pressureHpa = Number(tokens[5]);
  const windKnotsRaw = Number(tokens[6]);
  if (![grade, latTenths, lonTenths, pressureHpa, windKnotsRaw].every(Number.isFinite)) {
    throw new Error(`non-numeric JMA best-track data line: ${line}`);
  }
  const time = parseAnalysisTime(tokens[0]);
  return {
    time,
    lat: latTenths / 10,
    lon: lonTenths / 10,
    maximumWind: windKnotsRaw > 0 ? { value: windKnotsRaw, unit: 'kt', averagingMinutes: 10 } : null,
    pressure: pressureHpa > 0 ? { value: pressureHpa, unit: 'hPa' } : null,
    intensity: GRADE[grade] ?? `GRADE_${grade}`,
    sourcePointId: `JMA-${internationalNumber}-${tokens[0]}`,
    jmaGrade: grade
  };
}

export function parseBestTrackText(text) {
  const lines = String(text).split(/\r?\n/).filter(line => line.trim());
  const cyclones = [];
  for (let index = 0; index < lines.length;) {
    const header = parseHeaderLine(lines[index]);
    if (!header) throw new Error(`expected JMA header at line ${index + 1}`);
    const dataLines = lines.slice(index + 1, index + 1 + header.dataLineCount);
    if (dataLines.length !== header.dataLineCount || dataLines.some(line => String(line).trim().startsWith('66666'))) {
      throw new Error(`JMA ${header.internationalNumber} data-line count mismatch`);
    }
    const points = dataLines.map(line => parseDataLine(line, header.internationalNumber));
    cyclones.push({ ...header, points });
    index += 1 + header.dataLineCount;
  }
  return cyclones;
}

function htmlToText(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
}

export function detectPositionTableFinality(positionTableHtml, internationalNumber) {
  const text = htmlToText(positionTableHtml);
  const token = `台風${internationalNumber}号`;
  const index = text.indexOf(token);
  if (index < 0) return 'missing';
  const window = text.slice(index, index + 40);
  return window.includes('※') ? 'preliminary' : 'finalized';
}

export function buildReadinessStatus({ bestTrackText, positionTableHtml, internationalNumber = '2615' }) {
  const cyclones = parseBestTrackText(bestTrackText);
  const cyclone = cyclones.find(item => item.internationalNumber === internationalNumber) ?? null;
  const positionTableStatus = detectPositionTableFinality(positionTableHtml, internationalNumber);
  const bestTrackPublished = Boolean(cyclone);
  const readyForTruthImport = bestTrackPublished && positionTableStatus === 'finalized';
  let reason = 'ready';
  if (positionTableStatus === 'preliminary') reason = 'jma-post-analysis-not-finalized';
  else if (positionTableStatus === 'missing') reason = 'jma-position-table-target-missing';
  else if (!bestTrackPublished) reason = 'jma-best-track-target-not-published';
  return {
    ok: true,
    targetInternationalNumber: internationalNumber,
    positionTableStatus,
    bestTrackPublished,
    readyForTruthImport,
    reason,
    bestTrackCycloneCount: cyclones.length,
    targetRevisionDate: cyclone?.revisionDate ?? null,
    targetPointCount: cyclone?.points.length ?? 0,
    sourceHashes: {
      bestTrackSha256: sha256(bestTrackText),
      positionTableSha256: sha256(positionTableHtml)
    },
    semantics: {
      finalizedPositionTableRequired: true,
      rsmcBestTrackPublicationRequired: true,
      preliminaryTruthRejected: true,
      truthWritePerformed: false,
      verificationPerformed: false,
      trainingPerformed: false,
      promotionPerformed: false
    }
  };
}

export function buildCanonicalTruth({ bestTrackText, positionTableHtml, internationalNumber = '2615', stormKey = 'WP-2026-15', retrievedAt }) {
  const status = buildReadinessStatus({ bestTrackText, positionTableHtml, internationalNumber });
  if (!status.readyForTruthImport) {
    const error = new Error(`JMA truth is not finalized: ${status.reason}`);
    error.code = 'jma-truth-not-finalized';
    error.status = status;
    throw error;
  }
  const cyclone = parseBestTrackText(bestTrackText).find(item => item.internationalNumber === internationalNumber);
  const retrieval = retrievedAt ? new Date(retrievedAt).toISOString() : null;
  if (!retrieval) throw new Error('retrievedAt is required for canonical truth evidence');
  return {
    schemaVersion: TRUTH_SCHEMA_VERSION,
    stormKey,
    internationalNumber,
    source: 'JMA RSMC Tokyo Best Track',
    sourceUrl: JMA_BEST_TRACK_URL,
    positionTableUrl: JMA_POSITION_TABLE_URL,
    sourceVersion: `JMA-RSMC-bst2026-rev-${cyclone.revisionDate}`,
    retrievedAt: retrieval,
    finality: {
      status: 'finalized',
      positionTableStatus: status.positionTableStatus,
      bestTrackPublished: true,
      revisionDate: cyclone.revisionDate
    },
    name: cyclone.name,
    track: cyclone.points,
    evidence: status.sourceHashes,
    semantics: {
      officialRsmcPostAnalysis: true,
      preliminaryDataUsed: false,
      forecastDataUsedAsTruth: false,
      aiGenerated: false
    }
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]?.replace(/^--/, '')] = argv[i + 1];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bestTrack || !args.positionTable) {
    throw new Error('usage: ai20-jma-besttrack.mjs --bestTrack <file> --positionTable <file> [--target 2615] [--stormKey WP-2026-15] [--retrievedAt ISO] [--canonicalize true]');
  }
  const bestTrackText = fs.readFileSync(args.bestTrack, 'utf8');
  const positionTableHtml = fs.readFileSync(args.positionTable, 'utf8');
  const status = buildReadinessStatus({ bestTrackText, positionTableHtml, internationalNumber: args.target || '2615' });
  if (args.canonicalize === 'true') {
    const truth = buildCanonicalTruth({ bestTrackText, positionTableHtml, internationalNumber: args.target || '2615', stormKey: args.stormKey || 'WP-2026-15', retrievedAt: args.retrievedAt });
    process.stdout.write(`${JSON.stringify({ ok: true, status, truth }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
