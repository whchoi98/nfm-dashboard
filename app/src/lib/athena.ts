import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand,
  GetQueryResultsCommand } from '@aws-sdk/client-athena';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const GLUE_DB = process.env.GLUE_DB ?? 'nfm_dashboard';
const GLUE_TABLE = process.env.GLUE_TABLE ?? 'flows_archive';
const ATHENA_WORKGROUP = process.env.ATHENA_WORKGROUP ?? 'nfm-dashboard';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Deny-list-by-allowlist: no quotes, semicolons, backslashes, whitespace, etc. can
// reach the SQL string, so there is no quote-breakout / statement-injection surface.
const SAFE_FILTER_RE = /^[A-Za-z0-9._/-]+$/;

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
const MIN_LIMIT = 1;

/** Thrown when user-supplied query options fail validation (bad date / disallowed filter chars). */
export class HistoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryValidationError';
  }
}

export interface HistoryQueryOpts {
  from: string;
  to: string;
  monitor?: string;
  namespace?: string;
  metric?: string;
  limit?: number;
}

function assertDate(value: string, field: string): void {
  if (!DATE_RE.test(value)) throw new HistoryValidationError(`invalid date: ${field}`);
}

/** Validates + single-quotes a filter value against the allowlisted charset. Throws on anything else. */
function safeLiteral(value: string, field: string): string {
  if (!SAFE_FILTER_RE.test(value)) throw new HistoryValidationError(`invalid ${field}`);
  return `'${value}'`;
}

function clampLimit(limit: number | undefined): number {
  const n = Number.isFinite(limit) ? Math.trunc(limit as number) : DEFAULT_LIMIT;
  return Math.min(Math.max(n, MIN_LIMIT), MAX_LIMIT);
}

/**
 * PURE Athena SQL builder over `<GLUE_DB>.<GLUE_TABLE>` (Phase 13 flow archive).
 * Injection-safe: `from`/`to` MUST strictly match YYYY-MM-DD; string filters MUST
 * match `[A-Za-z0-9._/-]+` — anything else throws rather than reaching the query
 * string. Table/column identifiers are fixed literals, never interpolated from input.
 */
export function buildHistorySql(opts: HistoryQueryOpts): string {
  assertDate(opts.from, 'from');
  assertDate(opts.to, 'to');

  const clauses = [`dt BETWEEN '${opts.from}' AND '${opts.to}'`];
  if (opts.monitor !== undefined) {
    clauses.push(`monitor = ${safeLiteral(opts.monitor, 'monitor')}`);
  }
  if (opts.namespace !== undefined) {
    const ns = safeLiteral(opts.namespace, 'namespace');
    clauses.push(`(a_pod_namespace = ${ns} OR b_pod_namespace = ${ns})`);
  }
  if (opts.metric !== undefined) {
    clauses.push(`metric = ${safeLiteral(opts.metric, 'metric')}`);
  }

  const limit = clampLimit(opts.limit);
  return `SELECT * FROM ${GLUE_DB}.${GLUE_TABLE} WHERE ${clauses.join(' AND ')} `
    + `ORDER BY bucket DESC LIMIT ${limit}`;
}

export interface HistoryQueryResult {
  columns: string[];
  rows: string[][];
  scannedBytes: number;
  queryId: string;
}

let client: AthenaClient | undefined;
function athena(): AthenaClient {
  return (client ??= new AthenaClient({ region: REGION }));
}

const POLL_INTERVAL_MS = 700;
const POLL_TIMEOUT_MS = 25_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Starts a history query, polls to completion, and returns the tabular result. */
export async function runHistoryQuery(opts: HistoryQueryOpts): Promise<HistoryQueryResult> {
  const sql = buildHistorySql(opts);
  const { QueryExecutionId } = await athena().send(new StartQueryExecutionCommand({
    QueryString: sql, WorkGroup: ATHENA_WORKGROUP }));
  if (!QueryExecutionId) throw new Error('athena did not return a QueryExecutionId');

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const { QueryExecution } = await athena().send(
      new GetQueryExecutionCommand({ QueryExecutionId }));
    const state = QueryExecution?.Status?.State;
    if (state === 'SUCCEEDED') {
      const scannedBytes = QueryExecution?.Statistics?.DataScannedInBytes ?? 0;
      const { columns, rows } = await fetchResults(QueryExecutionId);
      return { columns, rows, scannedBytes, queryId: QueryExecutionId };
    }
    if (state === 'FAILED' || state === 'CANCELLED') {
      const reason = QueryExecution?.Status?.StateChangeReason ?? state;
      throw new Error(`athena query ${state.toLowerCase()}: ${reason}`);
    }
    if (Date.now() > deadline) throw new Error('query timeout');
    await sleep(POLL_INTERVAL_MS);
  }
}

// Athena repeats the column headers as the FIRST row of ResultSet.Rows — use
// ResultSetMetadata.ColumnInfo for `columns` and skip that header row here.
async function fetchResults(queryExecutionId: string): Promise<{ columns: string[]; rows: string[][] }> {
  const columns: string[] = [];
  const rows: string[][] = [];
  let nextToken: string | undefined;
  let first = true;
  do {
    const res = await athena().send(new GetQueryResultsCommand({
      QueryExecutionId: queryExecutionId, NextToken: nextToken }));
    if (first) {
      columns.push(...(res.ResultSet?.ResultSetMetadata?.ColumnInfo ?? [])
        .map((c) => c.Name ?? ''));
    }
    const resultRows = res.ResultSet?.Rows ?? [];
    const startAt = first ? 1 : 0; // skip the repeated header row on the first page only
    for (let i = startAt; i < resultRows.length; i++) {
      rows.push((resultRows[i].Data ?? []).map((d) => d.VarCharValue ?? ''));
    }
    first = false;
    nextToken = res.NextToken;
  } while (nextToken);
  return { columns, rows };
}
