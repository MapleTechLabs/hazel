import type { Dataset, Row, TableName } from "../fixtures/dataset.ts"

/**
 * Serves Electric shape requests (`GET /v1/shape?table=...`) from a fixture
 * dataset. Implements just enough of the protocol for the client to reach
 * `up-to-date`:
 *
 * - initial request (`offset=-1`): every row as an insert + an up-to-date control message
 * - live request (`live=true`): answered with up-to-date after a short pause. Holding it open
 *   would exhaust the browser's 6-connections-per-origin HTTP/1.1 pool and starve other shapes
 * - subset snapshot requests (`where`/`limit`/...): the full table, unfiltered
 *
 * Values are encoded as Postgres text and typed through the `electric-schema` header,
 * which is what the real Electric server does.
 */

type PgType = "text" | "bool" | "int4" | "float8" | "jsonb" | "timestamptz"

const pgTypeOf = (value: unknown): PgType | undefined => {
	if (value === null || value === undefined) return undefined
	if (value instanceof Date) return "timestamptz"
	if (typeof value === "boolean") return "bool"
	if (typeof value === "number") return Number.isInteger(value) ? "int4" : "float8"
	if (typeof value === "object") return "jsonb"
	return "text"
}

const encodeValue = (value: unknown): string | null => {
	if (value === null || value === undefined) return null
	if (value instanceof Date) return value.toISOString()
	if (typeof value === "object") return JSON.stringify(value)
	return String(value)
}

const schemaFor = (rows: ReadonlyArray<Row>) => {
	const schema: Record<string, { type: PgType }> = {}
	for (const row of rows) {
		for (const [column, value] of Object.entries(row)) {
			const type = pgTypeOf(value)
			if (type && !schema[column]) schema[column] = { type }
		}
	}
	// Columns that are null in every row still need a type for the timestamptz parser.
	for (const row of rows) {
		for (const column of Object.keys(row)) {
			if (!schema[column]) schema[column] = { type: column.endsWith("At") ? "timestamptz" : "text" }
		}
	}
	return schema
}

const SHAPE_OFFSET = "0_0"
const LIVE_POLL_DELAY_MS = 150

export const corsHeaders = (request: Request): Record<string, string> => ({
	"access-control-allow-origin": request.headers.get("origin") ?? "*",
	"access-control-allow-credentials": "true",
	"access-control-allow-headers": request.headers.get("access-control-request-headers") ?? "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-expose-headers":
		"electric-handle, electric-offset, electric-schema, electric-cursor, electric-up-to-date",
})

type ResponseKind = "initial" | "snapshot" | "live"

const UP_TO_DATE = { headers: { control: "up-to-date", global_last_seen_lsn: "0" } }

const encodeBody = (table: TableName | null, rows: ReadonlyArray<Row>, kind: ResponseKind) => {
	if (kind === "live") return JSON.stringify([UP_TO_DATE])
	const changeMessages = rows.map((row) => ({
		key: `"public"."${table}"/"${String(row.id)}"`,
		value: Object.fromEntries(Object.entries(row).map(([column, value]) => [column, encodeValue(value)])),
		headers: { operation: "insert", relation: ["public", table] },
	}))
	if (kind === "snapshot")
		return JSON.stringify({
			metadata: { snapshot_mark: 0, xmin: "0", xmax: "0", xip_list: [], database_lsn: "0" },
			data: changeMessages,
		})
	return JSON.stringify([...changeMessages, UP_TO_DATE])
}

/** Datasets are immutable, so each (dataset, table, kind) body and schema header is encoded once. */
const encoded = new WeakMap<Dataset, Map<string, { readonly schema: string; readonly body: string }>>()

const encodedShape = (dataset: Dataset, table: TableName | null, kind: ResponseKind) => {
	let byKey = encoded.get(dataset)
	if (!byKey) {
		byKey = new Map()
		encoded.set(dataset, byKey)
	}
	const key = `${table}:${kind}`
	let entry = byKey.get(key)
	if (!entry) {
		const rows = (table && dataset.tables[table]) || []
		entry = { schema: JSON.stringify(schemaFor(rows)), body: encodeBody(table, rows, kind) }
		byKey.set(key, entry)
	}
	return entry
}

export const handleShape = (request: Request, dataset: Dataset): Response | Promise<Response> => {
	const url = new URL(request.url)
	const table = url.searchParams.get("table") as TableName | null
	const isLive = url.searchParams.get("live") === "true"
	const isSubsetSnapshot = ["where", "limit", "order_by", "subset__where", "subset__limit"].some((param) =>
		url.searchParams.has(param),
	)
	const kind: ResponseKind = isLive ? "live" : isSubsetSnapshot ? "snapshot" : "initial"
	const { schema, body } = encodedShape(dataset, table, kind)
	const base = {
		...corsHeaders(request),
		"content-type": "application/json",
		"cache-control": "no-store",
		"electric-handle": `parity-${dataset.name}-${table}`,
		"electric-offset": SHAPE_OFFSET,
		"electric-schema": schema,
	}
	const upToDate = { ...base, "electric-up-to-date": "", "electric-cursor": "0" }

	if (kind === "live")
		return Bun.sleep(LIVE_POLL_DELAY_MS).then(() => new Response(body, { headers: upToDate }))
	return new Response(body, { headers: kind === "snapshot" ? base : upToDate })
}
