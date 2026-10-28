import { type SQLite, schema } from "@hazel/db"
import type { UserId } from "@hazel/schema"

type AnyTable = SQLite.Table<string, any, any, any>

/**
 * Result of building a WHERE clause with parameterized values
 */
export interface WhereClauseResult {
	whereClause: string
	params: unknown[]
}

/**
 * Summary of placeholder/param usage in a WHERE clause.
 */
export interface WhereClauseParamStats {
	paramsCount: number
	uniquePlaceholderCount: number
	maxPlaceholderIndex: number
	startsAtOne: boolean
	hasGaps: boolean
}

/**
 * Error thrown when WHERE clause placeholders do not match params.
 */
export class WhereClauseParamMismatchError extends Error {
	readonly stats: WhereClauseParamStats

	constructor(result: WhereClauseResult, stats: WhereClauseParamStats) {
		super(
			`Invalid WHERE clause params: placeholders must be sequential from $1 with max index equal to params length (params=${stats.paramsCount}, uniquePlaceholders=${stats.uniquePlaceholderCount}, maxPlaceholder=${stats.maxPlaceholderIndex}, startsAtOne=${stats.startsAtOne}, hasGaps=${stats.hasGaps})`,
		)
		this.name = "WhereClauseParamMismatchError"
		this.stats = stats
	}
}

/**
 * Calculate placeholder/param stats for a WHERE clause.
 */
export function getWhereClauseParamStats(result: WhereClauseResult): WhereClauseParamStats {
	const placeholderMatches = [...result.whereClause.matchAll(/\$(\d+)/g)]
	const placeholders = placeholderMatches
		.map((match) => Number(match[1]))
		.filter((index) => Number.isInteger(index) && index > 0)
	const uniqueSorted = [...new Set(placeholders)].sort((a, b) => a - b)

	let hasGaps = false
	for (let i = 0; i < uniqueSorted.length; i++) {
		if (uniqueSorted[i] !== i + 1) {
			hasGaps = true
			break
		}
	}

	return {
		paramsCount: result.params.length,
		uniquePlaceholderCount: uniqueSorted.length,
		maxPlaceholderIndex: uniqueSorted[uniqueSorted.length - 1] ?? 0,
		startsAtOne: uniqueSorted.length === 0 ? result.params.length === 0 : uniqueSorted[0] === 1,
		hasGaps,
	}
}

/**
 * Ensure placeholder numbering and params length are compatible with Electric SQL.
 */
export function assertWhereClauseParamsAreSequential(result: WhereClauseResult): void {
	const stats = getWhereClauseParamStats(result)

	// No placeholders is only valid when there are also no params.
	if (stats.uniquePlaceholderCount === 0) {
		if (stats.paramsCount === 0) {
			return
		}
		throw new WhereClauseParamMismatchError(result, stats)
	}

	// Placeholders must start at $1, have no gaps, and the max index must match params length.
	if (!stats.startsAtOne || stats.hasGaps || stats.maxPlaceholderIndex !== stats.paramsCount) {
		throw new WhereClauseParamMismatchError(result, stats)
	}
}

/** A table, written as its quoted name. */
export interface TableRef {
	readonly _tag: "TableRef"
	readonly name: string
}

/**
 * A column, written as its quoted, unqualified name: Electric requires unqualified column names in a
 * shape's WHERE clause.
 */
export interface ColumnRef {
	readonly _tag: "ColumnRef"
	readonly table: TableRef
	readonly name: string
}

/** SQL text with bound values, spliced columns, tables and nested fragments. */
export interface SQL {
	readonly _tag: "SQL"
	readonly strings: ReadonlyArray<string>
	readonly values: ReadonlyArray<unknown>
}

const isTagged = <Tag extends string>(value: unknown, tag: Tag): value is { readonly _tag: Tag } =>
	typeof value === "object" && value !== null && (value as { _tag?: unknown })._tag === tag

/** A fragment: `${value}` is bound, `${columnRef}`/`${tableRef}` are quoted names, `${sql}` is spliced. */
export const sql = (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>): SQL => ({
	_tag: "SQL",
	strings: [...strings],
	values,
})

/** A table's reference and its columns', by key, read from its effect-orm definition. */
export const refs = <T extends AnyTable>(
	table: T,
): { readonly [K in keyof T["columns"] & string]: ColumnRef } & {
	readonly $table: TableRef
} => {
	const tableRef: TableRef = { _tag: "TableRef", name: table.name }
	const columns: Record<string, ColumnRef | TableRef> = { $table: tableRef }
	for (const [key, type] of Object.entries(table.columns as Record<string, { sqlName?: string }>)) {
		columns[key] = { _tag: "ColumnRef", table: tableRef, name: type.sqlName ?? key }
	}
	return columns as never
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Renders a fragment with `$1, $2, ...` placeholders in the order values appear. */
const render = (fragment: SQL, params: Array<unknown>): string => {
	let text = fragment.strings[0] ?? ""
	fragment.values.forEach((value, index) => {
		if (isTagged(value, "SQL")) text += render(value as SQL, params)
		else if (isTagged(value, "ColumnRef") || isTagged(value, "TableRef"))
			text += quote((value as ColumnRef).name)
		else {
			params.push(value)
			text += `$${params.length}`
		}
		text += fragment.strings[index + 1] ?? ""
	})
	return text
}

export const col = (column: ColumnRef): SQL => sql`${column}`

export const eqCol = <T>(column: ColumnRef, value: T | SQL): SQL => sql`${column} = ${value}`

export const isNullCol = (column: ColumnRef): SQL => sql`${column} IS NULL`

export const inSubquery = (column: ColumnRef, subquerySql: SQL): SQL => sql`${column} IN ${subquerySql}`

const buildParamList = (values: readonly unknown[]): SQL => {
	const strings = ["(", ...values.slice(1).map(() => ", "), ")"]
	return { _tag: "SQL", strings, values }
}

const buildSubquery = (selectedColumn: ColumnRef, whereExpr: SQL): SQL =>
	sql`(SELECT ${selectedColumn} FROM ${selectedColumn.table} WHERE ${whereExpr})`

const dedupeParams = (whereClause: string, params: unknown[]): WhereClauseResult => {
	const dedupedParams: unknown[] = []
	const placeholderMap = new Map<number, number>()

	params.forEach((param, index) => {
		const existingIndex = dedupedParams.findIndex((existingParam) => Object.is(existingParam, param))
		if (existingIndex === -1) {
			dedupedParams.push(param)
			placeholderMap.set(index + 1, dedupedParams.length)
			return
		}

		placeholderMap.set(index + 1, existingIndex + 1)
	})

	const dedupedWhereClause = whereClause.replace(/\$(\d+)\b/g, (_, rawIndex: string) => {
		const nextIndex = placeholderMap.get(Number(rawIndex))
		return `$${nextIndex ?? Number(rawIndex)}`
	})

	return {
		whereClause: dedupedWhereClause,
		params: dedupedParams,
	}
}

/** Renders a WHERE expression as Electric takes it: placeholders from `$1`, one per distinct value. */
export function sqlToWhereClause(whereExpr: SQL): WhereClauseResult {
	const params: Array<unknown> = []
	const whereClause = render(whereExpr, params).trim()
	return dedupeParams(whereClause, params)
}

const channelAccess = refs(schema.channelAccessTable)
const organizationMembers = refs(schema.organizationMembersTable)
const channels = refs(schema.channelsTable)

/**
 * Build IN clause with sorted IDs using unqualified column name.
 * Uses column.name for Electric SQL compatibility (Electric requires unqualified column names).
 *
 * @param column - The column to filter on (uses column.name for unqualified name)
 * @param values - Array of values for the IN clause
 * @returns WhereClauseResult with parameterized WHERE clause
 */
export function buildInClause<T extends string>(column: ColumnRef, values: readonly T[]): WhereClauseResult {
	if (values.length === 0) {
		return { whereClause: "false", params: [] }
	}
	const sorted = [...values].sort()
	return sqlToWhereClause(sql`${col(column)} IN ${buildParamList(sorted)}`)
}

/**
 * Build IN clause with deletedAt IS NULL check using unqualified column names.
 *
 * @param column - The column to filter on
 * @param values - Array of values for the IN clause
 * @param deletedAtColumn - The deletedAt column to check for NULL
 * @returns WhereClauseResult with parameterized WHERE clause
 */
export function buildInClauseWithDeletedAt<T extends string>(
	column: ColumnRef,
	values: readonly T[],
	deletedAtColumn: ColumnRef,
): WhereClauseResult {
	if (values.length === 0) {
		return { whereClause: "false", params: [] }
	}
	const sorted = [...values].sort()
	return sqlToWhereClause(
		sql`${col(column)} IN ${buildParamList(sorted)} AND ${isNullCol(deletedAtColumn)}`,
	)
}

/**
 * Build equality check using unqualified column name.
 *
 * @param column - The column to filter on
 * @param value - The value to compare against
 * @param paramIndex - The parameter index (default: 1)
 * @returns WhereClauseResult with parameterized WHERE clause
 */
export function buildEqClause<T>(column: ColumnRef, value: T, paramIndex = 1): WhereClauseResult {
	const result = sqlToWhereClause(eqCol(column, value))
	if (paramIndex === 1) {
		return result
	}

	return {
		whereClause: result.whereClause.replace(/\$1\b/g, `$${paramIndex}`),
		params: result.params,
	}
}

/**
 * Build simple deletedAt IS NULL check using unqualified column name.
 *
 * @param deletedAtColumn - The deletedAt column to check for NULL
 * @returns WhereClauseResult with no parameters
 */
export function buildDeletedAtNullClause(deletedAtColumn: ColumnRef): WhereClauseResult {
	return sqlToWhereClause(isNullCol(deletedAtColumn))
}

/**
 * Build a "no filter" clause that matches all rows.
 *
 * @returns WhereClauseResult that matches all rows
 */
export function buildNoFilterClause(): WhereClauseResult {
	return {
		whereClause: "true",
		params: [],
	}
}

/**
 * Build channel visibility clause using subquery.
 * Shows channels using precomputed channel access rows for the user.
 *
 * Uses Electric's subquery feature (requires ELECTRIC_FEATURE_FLAGS=allow_subqueries).
 *
 * @param userId - The user's internal database UUID
 * @param deletedAtColumn - The deletedAt column to check for NULL
 * @returns WhereClauseResult with parameterized WHERE clause and subquery
 */
export function buildChannelVisibilityClause(userId: UserId, deletedAtColumn: ColumnRef): WhereClauseResult {
	const channelAccessSubquery = buildSubquery(channelAccess.channelId, eqCol(channelAccess.userId, userId))

	return sqlToWhereClause(
		sql`${isNullCol(deletedAtColumn)} AND ${inSubquery(channels.id, channelAccessSubquery)}`,
	)
}

/**
 * Build organization membership clause using subquery.
 * Filters rows to only those in organizations the user is a member of.
 *
 * Uses Electric's subquery feature (requires ELECTRIC_FEATURE_FLAGS=allow_subqueries).
 *
 * @param userId - The user's internal database UUID
 * @param orgIdColumn - The organizationId column to filter on
 * @param deletedAtColumn - Optional deletedAt column to check for NULL
 * @returns WhereClauseResult with parameterized WHERE clause and subquery
 */
export function buildOrgMembershipClause(
	userId: UserId,
	orgIdColumn: ColumnRef,
	deletedAtColumn?: ColumnRef,
): WhereClauseResult {
	const orgMembershipSubquery = buildSubquery(
		organizationMembers.organizationId,
		sql`${eqCol(organizationMembers.userId, userId)} AND ${isNullCol(organizationMembers.deletedAt)}`,
	)

	const baseCondition = inSubquery(orgIdColumn, orgMembershipSubquery)
	const whereExpr = deletedAtColumn
		? sql`${isNullCol(deletedAtColumn)} AND ${baseCondition}`
		: baseCondition

	return sqlToWhereClause(whereExpr)
}

/**
 * Build user organization membership clause using subquery.
 * Filters users to only those who are members of the same organizations as the current user.
 *
 * Uses Electric's subquery feature (requires ELECTRIC_FEATURE_FLAGS=allow_subqueries).
 *
 * @param userId - The user's internal database UUID
 * @param userIdColumn - The user id column to filter on (users.id)
 * @param deletedAtColumn - The deletedAt column to check for NULL
 * @returns WhereClauseResult with parameterized WHERE clause and subquery
 */
export function buildUserOrgMembershipClause(
	userId: UserId,
	userIdColumn: ColumnRef,
	deletedAtColumn: ColumnRef,
): WhereClauseResult {
	const currentUserOrgIds = buildSubquery(
		organizationMembers.organizationId,
		sql`${eqCol(organizationMembers.userId, userId)} AND ${isNullCol(organizationMembers.deletedAt)}`,
	)
	const sharedOrgUsers = buildSubquery(
		organizationMembers.userId,
		sql`${col(organizationMembers.organizationId)} IN ${currentUserOrgIds} AND ${isNullCol(organizationMembers.deletedAt)}`,
	)

	return sqlToWhereClause(
		sql`${isNullCol(deletedAtColumn)} AND ${inSubquery(userIdColumn, sharedOrgUsers)}`,
	)
}

/**
 * Build user membership clause using subquery.
 * Filters rows to only those belonging to the user's organization memberships.
 *
 * Uses Electric's subquery feature (requires ELECTRIC_FEATURE_FLAGS=allow_subqueries).
 *
 * @param userId - The user's internal database UUID
 * @param memberIdColumn - The memberId column to filter on
 * @returns WhereClauseResult with parameterized WHERE clause and subquery
 */
export function buildUserMembershipClause(userId: UserId, memberIdColumn: ColumnRef): WhereClauseResult {
	const membershipSubquery = buildSubquery(
		organizationMembers.id,
		sql`${eqCol(organizationMembers.userId, userId)} AND ${isNullCol(organizationMembers.deletedAt)}`,
	)

	return sqlToWhereClause(inSubquery(memberIdColumn, membershipSubquery))
}

/**
 * Build channel access clause using subquery.
 * Filters rows to only those in channels the user has access to.
 *
 * Uses Electric's subquery feature (requires ELECTRIC_FEATURE_FLAGS=allow_subqueries).
 *
 * @param userId - The user's internal database UUID
 * @param channelIdColumn - The channelId column to filter on
 * @param deletedAtColumn - Optional deletedAt column to check for NULL
 * @returns WhereClauseResult with parameterized WHERE clause and subquery
 */
export function buildChannelAccessClause(
	userId: UserId,
	channelIdColumn: ColumnRef,
	deletedAtColumn?: ColumnRef,
): WhereClauseResult {
	const channelAccessSubquery = buildSubquery(channelAccess.channelId, eqCol(channelAccess.userId, userId))
	const baseCondition = inSubquery(channelIdColumn, channelAccessSubquery)
	const whereExpr = deletedAtColumn
		? sql`${isNullCol(deletedAtColumn)} AND ${baseCondition}`
		: baseCondition

	return sqlToWhereClause(whereExpr)
}

/**
 * Build integration connection clause using subquery.
 * Filters to org-level connections in user's orgs OR user's own connections.
 *
 * Uses Electric's subquery feature (requires ELECTRIC_FEATURE_FLAGS=allow_subqueries).
 *
 * @param userId - The user's internal database UUID
 * @param deletedAtColumn - The deletedAt column to check for NULL
 * @returns WhereClauseResult with parameterized WHERE clause and subquery
 */
export function buildIntegrationConnectionClause(
	userId: UserId,
	deletedAtColumn: ColumnRef,
): WhereClauseResult {
	const orgMembershipSubquery = buildSubquery(
		organizationMembers.organizationId,
		sql`${eqCol(organizationMembers.userId, userId)} AND ${isNullCol(organizationMembers.deletedAt)}`,
	)

	return sqlToWhereClause(
		sql`${isNullCol(deletedAtColumn)} AND (("userId" IS NULL AND "organizationId" IN ${orgMembershipSubquery}) OR "userId" = ${userId})`,
	)
}

/**
 * Apply WHERE clause result to Electric URL with params.
 * Sets the "where" parameter and appends "params[N]" parameters directly to the URL string.
 *
 * URLSearchParams.set encodes brackets as %5B/%5D which Electric SQL may not decode,
 * causing HTTP 400 "Parameters must be numbered sequentially, starting from 1".
 * We build the params portion manually to keep brackets unencoded.
 *
 * @param url - The URL to modify (where clause is set via searchParams)
 * @param result - The WhereClauseResult
 * @returns The final URL string with unencoded bracket params
 */
export function applyWhereToElectricUrl(url: URL, result: WhereClauseResult): string {
	assertWhereClauseParamsAreSequential(result)
	url.searchParams.set("where", result.whereClause)

	// Append params with unencoded brackets directly to the URL string.
	// Electric uses params[1], params[2], etc. (1-indexed)
	let urlStr = url.toString()
	for (let i = 0; i < result.params.length; i++) {
		urlStr += `&params[${i + 1}]=${encodeURIComponent(String(result.params[i]))}`
	}
	return urlStr
}
