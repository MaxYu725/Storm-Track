const PLAN_VERSION = 'historical-backfill-import/v1';
const MAX_PLAN_ROWS = 5000;
const DEFAULT_BATCH_SIZE = 50;

const TABLES = Object.freeze({
  backfill_runs: Object.freeze({
    primaryKey: 'run_id',
    columns: ['run_id', 'import_version', 'source', 'generated_at', 'fingerprint', 'status']
  }),
  historical_storms: Object.freeze({
    primaryKey: 'storm_key',
    columns: ['storm_key', 'name_tc', 'name_en', 'season', 'basin', 'backfill_mode', 'agency_skill_eligible', 'updated_at']
  }),
  truth_datasets: Object.freeze({
    primaryKey: 'dataset_id',
    columns: ['dataset_id', 'storm_key', 'source', 'source_url', 'source_version', 'retrieved_at', 'fingerprint']
  }),
  truth_points: Object.freeze({
    primaryKey: 'point_id',
    columns: ['point_id', 'dataset_id', 'valid_time', 'lat', 'lon', 'maximum_wind_json', 'pressure_json', 'intensity', 'source_point_id', 'fingerprint']
  }),
  forecast_snapshots: Object.freeze({
    primaryKey: 'snapshot_id',
    columns: ['snapshot_id', 'storm_key', 'as_of', 'provenance_type', 'provenance_source', 'provenance_source_url', 'archive_id', 'original_issued_at', 'archive_captured_at', 'payload_hash', 'eligible_for_walkforward', 'rejection_reason', 'snapshot_json', 'impact_json', 'signal_inputs_json', 'source_availability_json', 'fingerprint']
  }),
  signal_outcomes: Object.freeze({
    primaryKey: 'outcome_id',
    columns: ['outcome_id', 'storm_key', 'source', 'source_url', 'signal_system_era', 'highest_signal', 'issued_at', 'ended_at', 'details_json', 'fingerprint']
  })
});

const TABLE_ORDER = Object.freeze([
  'backfill_runs',
  'historical_storms',
  'truth_datasets',
  'truth_points',
  'forecast_snapshots',
  'signal_outcomes'
]);

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function asNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw httpError(400, 'invalid-plan', `${name} must be a non-empty string`);
  }
  return value.trim();
}

function validateRow(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw httpError(400, 'invalid-plan-row', `rows[${index}] must be an object`);
  }
  const table = asNonEmptyString(row.table, `rows[${index}].table`);
  const definition = TABLES[table];
  if (!definition) {
    throw httpError(400, 'unsupported-table', `rows[${index}] targets unsupported table ${table}`);
  }
  if (!row.values || typeof row.values !== 'object' || Array.isArray(row.values)) {
    throw httpError(400, 'invalid-plan-row', `rows[${index}].values must be an object`);
  }
  const unknownColumns = Object.keys(row.values).filter(column => !definition.columns.includes(column));
  if (unknownColumns.length) {
    throw httpError(400, 'unsupported-column', `rows[${index}] contains unsupported columns`, { table, unknownColumns });
  }
  const primaryValue = row.values[definition.primaryKey];
  if (primaryValue == null || String(primaryValue) === '') {
    throw httpError(400, 'missing-primary-key', `rows[${index}] is missing ${definition.primaryKey}`);
  }
  if (row.primaryKey != null && String(row.primaryKey) !== String(primaryValue)) {
    throw httpError(400, 'primary-key-mismatch', `rows[${index}].primaryKey does not match ${definition.primaryKey}`);
  }
  return {
    table,
    primaryKey: String(primaryValue),
    values: Object.fromEntries(definition.columns.filter(column => Object.hasOwn(row.values, column)).map(column => [column, row.values[column]]))
  };
}

export function validateImportPlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'invalid-plan', 'request body must be an AI-7 import plan object');
  }
  if (input.schemaVersion !== PLAN_VERSION) {
    throw httpError(400, 'unsupported-plan-version', `schemaVersion must be ${PLAN_VERSION}`);
  }
  const runId = asNonEmptyString(input.runId, 'runId');
  const rowsInput = Array.isArray(input.rows) ? input.rows : null;
  if (!rowsInput || !rowsInput.length) throw httpError(400, 'invalid-plan', 'rows must contain at least one row');
  if (rowsInput.length > MAX_PLAN_ROWS) {
    throw httpError(413, 'plan-too-large', `plan contains ${rowsInput.length} rows; maximum is ${MAX_PLAN_ROWS}`);
  }
  const rows = rowsInput.map(validateRow);
  const runRows = rows.filter(row => row.table === 'backfill_runs');
  if (runRows.length !== 1) throw httpError(400, 'invalid-run-row', 'plan must contain exactly one backfill_runs row');
  const runRow = runRows[0];
  if (runRow.primaryKey !== runId) throw httpError(400, 'run-id-mismatch', 'runId must match backfill_runs.run_id');
  if (runRow.values.import_version !== PLAN_VERSION) {
    throw httpError(400, 'run-version-mismatch', `backfill_runs.import_version must be ${PLAN_VERSION}`);
  }
  const runFingerprint = asNonEmptyString(runRow.values.fingerprint, 'backfill_runs.fingerprint');

  const duplicateKeys = [];
  const seen = new Set();
  rows.forEach(row => {
    const key = `${row.table}\u0000${row.primaryKey}`;
    if (seen.has(key)) duplicateKeys.push({ table: row.table, primaryKey: row.primaryKey });
    seen.add(key);
  });
  if (duplicateKeys.length) throw httpError(400, 'duplicate-plan-primary-key', 'plan contains duplicate table primary keys', duplicateKeys);

  const tableCounts = Object.fromEntries(TABLE_ORDER.map(table => [table, 0]));
  rows.forEach(row => { tableCounts[row.table] += 1; });
  const orderedRows = rows.slice().sort((left, right) => TABLE_ORDER.indexOf(left.table) - TABLE_ORDER.indexOf(right.table));

  return {
    schemaVersion: PLAN_VERSION,
    runId,
    runFingerprint,
    source: input.source ?? runRow.values.source ?? null,
    generatedAt: input.generatedAt ?? runRow.values.generated_at ?? null,
    rows: orderedRows,
    tableCounts,
    rowCount: rows.length
  };
}

export function previewImportPlan(input) {
  const plan = validateImportPlan(input);
  return {
    ok: true,
    dryRun: true,
    schemaVersion: plan.schemaVersion,
    runId: plan.runId,
    source: plan.source,
    generatedAt: plan.generatedAt,
    rowCount: plan.rowCount,
    tableCounts: plan.tableCounts,
    writesPerformed: false,
    semantics: {
      analysisDbOnly: true,
      preparedStatementsRequired: true,
      idempotentRunFingerprint: true,
      productionDatabaseWritten: false
    }
  };
}

function placeholders(count) {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(', ');
}

function compileInsert(db, row) {
  const definition = TABLES[row.table];
  const columns = definition.columns.filter(column => Object.hasOwn(row.values, column));
  const values = columns.map(column => row.values[column] ?? null);
  if (!columns.length) throw httpError(400, 'invalid-plan-row', `no writable columns for ${row.table}`);

  let sql;
  if (row.table === 'historical_storms') {
    const updates = columns.filter(column => column !== definition.primaryKey).map(column => `${column}=excluded.${column}`).join(', ');
    sql = `INSERT INTO ${row.table} (${columns.join(', ')}) VALUES (${placeholders(columns.length)}) ON CONFLICT(${definition.primaryKey}) DO UPDATE SET ${updates}`;
  } else if (row.table === 'backfill_runs') {
    sql = `INSERT INTO backfill_runs (${columns.join(', ')}) VALUES (${placeholders(columns.length)}) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status`;
  } else {
    sql = `INSERT OR IGNORE INTO ${row.table} (${columns.join(', ')}) VALUES (${placeholders(columns.length)})`;
  }
  return db.prepare(sql).bind(...values);
}

async function findExistingRun(db, runId, fingerprint) {
  const byRunId = await db.prepare('SELECT run_id, fingerprint, status FROM backfill_runs WHERE run_id = ?1 LIMIT 1')
    .bind(runId)
    .first();
  if (byRunId) return { match: 'run-id', row: byRunId };
  const byFingerprint = await db.prepare('SELECT run_id, fingerprint, status FROM backfill_runs WHERE fingerprint = ?1 LIMIT 1')
    .bind(fingerprint)
    .first();
  return byFingerprint ? { match: 'fingerprint', row: byFingerprint } : null;
}

async function setRunStatus(db, runId, status) {
  return db.prepare('UPDATE backfill_runs SET status = ?1 WHERE run_id = ?2').bind(status, runId).run();
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function createBackfillRepository(db, options = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new Error('ANALYSIS_DB D1 binding is required');
  }
  const batchSize = Number.isInteger(options.batchSize) && options.batchSize > 0 ? options.batchSize : DEFAULT_BATCH_SIZE;

  return Object.freeze({
    preview(input) {
      return previewImportPlan(input);
    },

    async importPlan(input) {
      const plan = validateImportPlan(input);
      const existingMatch = await findExistingRun(db, plan.runId, plan.runFingerprint);
      if (existingMatch) {
        const existing = existingMatch.row;
        if (existingMatch.match === 'run-id' && existing.fingerprint !== plan.runFingerprint) {
          throw httpError(409, 'run-id-conflict', `runId ${plan.runId} already exists with a different fingerprint`);
        }
        if (existingMatch.match === 'fingerprint' && existing.run_id !== plan.runId && existing.status !== 'completed') {
          throw httpError(409, 'run-fingerprint-conflict', `fingerprint is already owned by unfinished run ${existing.run_id}`);
        }
        if (existing.fingerprint === plan.runFingerprint && existing.status === 'completed') {
          return {
            ok: true,
            status: 'already-imported',
            runId: existing.run_id,
            rowCount: plan.rowCount,
            tableCounts: plan.tableCounts,
            writesPerformed: false
          };
        }
      }

      const runRow = plan.rows.find(row => row.table === 'backfill_runs');
      const dataRows = plan.rows.filter(row => row.table !== 'backfill_runs');
      const importingRunRow = { ...runRow, values: { ...runRow.values, status: 'importing' } };
      await compileInsert(db, importingRunRow).run();

      let completedBatches = 0;
      try {
        for (const batchRows of chunk(dataRows, batchSize)) {
          const statements = batchRows.map(row => compileInsert(db, row));
          if (statements.length) await db.batch(statements);
          completedBatches += 1;
        }
        await setRunStatus(db, plan.runId, 'completed');
      } catch (error) {
        try {
          await setRunStatus(db, plan.runId, 'failed');
        } catch (statusError) {
          console.error(JSON.stringify({ event: 'backfill-status-update-failed', runId: plan.runId, error: String(statusError) }));
        }
        const wrapped = httpError(500, 'import-failed', 'ANALYSIS_DB import failed', {
          runId: plan.runId,
          completedBatches,
          recoverableByRetry: true
        });
        wrapped.cause = error;
        throw wrapped;
      }

      return {
        ok: true,
        status: 'completed',
        runId: plan.runId,
        rowCount: plan.rowCount,
        dataRowCount: dataRows.length,
        tableCounts: plan.tableCounts,
        batchSize,
        completedBatches,
        writesPerformed: true,
        semantics: {
          analysisDbOnly: true,
          perBatchTransactionSemantics: true,
          wholeRunAtomic: false,
          retryIsIdempotent: true
        }
      };
    }
  });
}

export { PLAN_VERSION, MAX_PLAN_ROWS, DEFAULT_BATCH_SIZE, TABLES };
