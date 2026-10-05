/**
 * Craft API Client
 *
 * Effect-based HTTP client for Craft REST API with schema validation,
 * retries, and proper error handling.
 *
 * Key difference from other integrations: Craft uses per-space base URLs
 * and Bearer tokens instead of a single OAuth endpoint.
 */

import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from "effect/http"
import { Context, Duration, Effect, Layer, Schedule, Schema } from "effect"

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_TIMEOUT = Duration.seconds(30)

// ============================================================================
// Domain Schemas (exported for consumers)
// ============================================================================

export const CraftBlockType = Schema.Literals([
	"text",
	"line",
	"page",
	"code",
	"image",
	"file",
	"drawing",
	"richUrl",
	"video",
	"collection",
	"textBlock",
	"horizontalRuleBlock",
	"tableBlock",
	"codeBlock",
	"imageBlock",
	"fileBlock",
	"drawingBlock",
	"urlBlock",
	"videoBlock",
	"cardBlock",
])
export type CraftBlockType = typeof CraftBlockType.Type

export const CraftBlock = Schema.Struct({
	id: Schema.String,
	type: Schema.String,
	markdown: Schema.optional(Schema.String),
	content: Schema.optional(Schema.Unknown),
	style: Schema.optional(Schema.Unknown),
	subblocks: Schema.optional(Schema.Array(Schema.Unknown)),
	hasSubblocks: Schema.optional(Schema.Boolean),
	url: Schema.optional(Schema.String),
	filename: Schema.optional(Schema.String),
	listStyle: Schema.optional(Schema.Unknown),
})
export type CraftBlock = typeof CraftBlock.Type

export const CraftDocument = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	type: Schema.optional(Schema.String),
	createdAt: Schema.optional(Schema.String),
	updatedAt: Schema.optional(Schema.String),
	lastModifiedAt: Schema.optional(Schema.String),
	folderId: Schema.optional(Schema.NullOr(Schema.String)),
	dailyNoteDate: Schema.optional(Schema.String),
	clickableLink: Schema.optional(Schema.String),
})
export type CraftDocument = typeof CraftDocument.Type

export const CraftFolder = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	createdAt: Schema.optional(Schema.String),
	updatedAt: Schema.optional(Schema.String),
	parentId: Schema.optional(Schema.NullOr(Schema.String)),
	folders: Schema.optional(Schema.Array(Schema.Unknown)),
	documentCount: Schema.optional(Schema.Number),
})
export type CraftFolder = typeof CraftFolder.Type

export const CraftTask = Schema.Struct({
	id: Schema.String,
	markdown: Schema.optional(Schema.String),
	taskInfo: Schema.optional(Schema.Unknown),
	content: Schema.optional(Schema.String),
	isDone: Schema.optional(Schema.Boolean),
	documentId: Schema.optional(Schema.String),
	createdAt: Schema.optional(Schema.String),
	updatedAt: Schema.optional(Schema.String),
})
export type CraftTask = typeof CraftTask.Type

export const CraftCollection = Schema.Struct({
	id: Schema.String,
	name: Schema.optional(Schema.String),
	title: Schema.optional(Schema.String),
	type: Schema.optional(Schema.String),
})
export type CraftCollection = typeof CraftCollection.Type

export const CraftSpaceInfo = Schema.Struct({
	id: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	type: Schema.optional(Schema.String),
})
export type CraftSpaceInfo = typeof CraftSpaceInfo.Type

// ============================================================================
// Error Types
// ============================================================================

export class CraftApiError extends Schema.TaggedError<CraftApiError>()("CraftApiError", {
	message: Schema.String,
	status: Schema.optional(Schema.Number),
	cause: Schema.optional(Schema.Unknown),
}) {}

export class CraftNotFoundError extends Schema.TaggedError<CraftNotFoundError>()("CraftNotFoundError", {
	resourceType: Schema.String,
	resourceId: Schema.String,
}) {}

export class CraftRateLimitError extends Schema.TaggedError<CraftRateLimitError>()("CraftRateLimitError", {
	message: Schema.String,
	retryAfter: Schema.optional(Schema.Number),
}) {}

// ============================================================================
// Internal Response Schemas
// ============================================================================

const ConnectionInfoResponse = Schema.Struct({
	id: Schema.optional(Schema.String),
	name: Schema.optional(Schema.String),
	type: Schema.optional(Schema.String),
	space: Schema.optional(CraftSpaceInfo),
})

type CraftConnectionInfo = typeof ConnectionInfoResponse.Type

export const normalizeCraftConnectionInfo = (response: CraftConnectionInfo): CraftSpaceInfo => ({
	id: response.space?.id ?? response.id,
	name: response.space?.name ?? response.name,
	type: response.space?.type ?? response.type,
})

export const normalizeCraftSearchDocumentsResponse = (raw: unknown): unknown[] => {
	if (Array.isArray(raw)) {
		return raw
	}
	if (
		raw &&
		typeof raw === "object" &&
		"items" in raw &&
		Array.isArray((raw as { items: unknown }).items)
	) {
		return (raw as { items: unknown[] }).items
	}
	return []
}

const normalizeCraftItemsResponse = (raw: unknown): unknown[] => {
	if (Array.isArray(raw)) {
		return raw
	}

	if (
		raw &&
		typeof raw === "object" &&
		"items" in raw &&
		Array.isArray((raw as { items: unknown }).items)
	) {
		return (raw as { items: unknown[] }).items
	}

	return []
}

// ============================================================================
// Retry Strategy
// ============================================================================

/**
 * Retry schedule for transient Craft API errors.
 * Retries up to 3 times with exponential backoff (100ms, 200ms, 400ms)
 */
const makeRetrySchedule = Schedule.max([Schedule.exponential("100 millis"), Schedule.recurs(3)])

/**
 * Check if an error is retryable (rate limit or server error)
 */
const isRetryableError = (error: CraftApiError | CraftNotFoundError | CraftRateLimitError): boolean => {
	if (error._tag === "CraftRateLimitError") return true
	if (error._tag === "CraftApiError" && error.status !== undefined) {
		return error.status === 429 || error.status >= 500
	}
	return false
}

// ============================================================================
// CraftApiClient Service
// ============================================================================

/**
 * Craft API Client Service.
 *
 * Provides methods for interacting with the Craft REST API using Effect HttpClient
 * with proper schema validation, retries, and timeouts.
 *
 * Unlike Linear (single GraphQL endpoint), Craft uses per-space base URLs
 * with Bearer token authentication.
 *
 * ## Usage
 *
 * ```typescript
 * const spaceInfo = yield* CraftApiClient.getSpaceInfo(baseUrl, accessToken)
 * const documents = yield* CraftApiClient.listDocuments(baseUrl, accessToken)
 * ```
 */
export class CraftApiClient extends Context.Service<CraftApiClient>()("CraftApiClient", {
	make: Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient

		/**
		 * Create an authenticated client with Craft headers for a specific space
		 */
		const makeClient = (baseUrl: string, accessToken: string) =>
			httpClient.pipe(
				HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl)),
				HttpClient.mapRequest(
					HttpClientRequest.setHeaders({
						Authorization: `Bearer ${accessToken}`,
						"Content-Type": "application/json",
						Accept: "application/json",
					}),
				),
			)

		/**
		 * Execute an HTTP request and handle all errors
		 */
		const executeRequest = (
			client: HttpClient.HttpClient,
			method: "GET" | "POST" | "PUT" | "DELETE",
			path: string,
			body?: unknown,
		): Effect.Effect<unknown, CraftApiError | CraftRateLimitError | CraftNotFoundError> =>
			Effect.gen(function* () {
				const jsonBody = body ? HttpBody.text(JSON.stringify(body), "application/json") : undefined
				const request =
					method === "GET"
						? client.get(path)
						: method === "POST"
							? client.post(path, { body: jsonBody })
							: method === "PUT"
								? client.put(path, { body: jsonBody })
								: client.del(path, { body: jsonBody })

				const response = yield* request.pipe(Effect.scoped, Effect.timeout(DEFAULT_TIMEOUT))

				if (response.status === 429) {
					return yield* Effect.fail(
						new CraftRateLimitError({
							message: "Rate limit exceeded, try again later",
						}),
					)
				}

				if (response.status === 401 || response.status === 403) {
					return yield* Effect.fail(
						new CraftApiError({
							message: "Craft authentication failed - check your API token",
							status: response.status,
						}),
					)
				}

				if (response.status === 404) {
					return yield* Effect.fail(
						new CraftNotFoundError({
							resourceType: "resource",
							resourceId: path,
						}),
					)
				}

				if (response.status >= 400) {
					return yield* Effect.fail(
						new CraftApiError({
							message: `Craft API error (${response.status})`,
							status: response.status,
						}),
					)
				}

				// For 204 No Content, return empty
				if (response.status === 204) {
					return undefined
				}

				return yield* response.json
			}).pipe(
				Effect.catchTag("TimeoutError", () =>
					Effect.fail(new CraftApiError({ message: "Request timed out" })),
				),
				Effect.catchTag("HttpClientError", (error) =>
					Effect.fail(
						new CraftApiError({
							message: error.response
								? `Response error: ${String(error)}`
								: `Network error: ${String(error)}`,
							status: error.response?.status,
							cause: error,
						}),
					),
				),
			)

		// ====================================================================
		// Connection
		// ====================================================================

		const getSpaceInfo = (baseUrl: string, accessToken: string) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "GET", "/connection").pipe(
					Effect.flatMap((raw) =>
						Schema.decodeUnknownEffect(ConnectionInfoResponse)(raw).pipe(
							Effect.map(normalizeCraftConnectionInfo),
							Effect.mapError(
								(e) =>
									new CraftApiError({
										message: "Unexpected response format for /connection endpoint",
										cause: e,
									}),
							),
						),
					),
				)
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.getSpaceInfo"),
			)

		// ====================================================================
		// Blocks
		// ====================================================================

		const getBlocks = (baseUrl: string, accessToken: string, documentId: string, blockId?: string) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const resolvedBlockId = blockId ?? documentId
				const path = `/blocks?id=${encodeURIComponent(resolvedBlockId)}`
				const raw = yield* executeRequest(client, "GET", path)
				const normalizedBlocks = normalizeCraftItemsResponse(raw)
				return yield* Schema.decodeUnknownEffect(Schema.Array(CraftBlock))(normalizedBlocks).pipe(
					Effect.catch(() =>
						Effect.succeed(
							normalizedBlocks.length > 0
								? (normalizedBlocks as CraftBlock[])
								: [raw as CraftBlock],
						),
					),
				)
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.getBlocks", { attributes: { documentId } }),
			)

		const insertBlocks = (
			baseUrl: string,
			accessToken: string,
			documentId: string,
			blocks: ReadonlyArray<{ type: string; content?: string; listStyle?: unknown }>,
			parentBlockId?: string,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const pageId = parentBlockId ?? documentId
				const transformedBlocks = blocks.map((block) => ({
					type: block.type === "textBlock" ? "text" : block.type,
					markdown: block.content ?? "",
					...(block.listStyle !== undefined ? { listStyle: block.listStyle } : {}),
				}))

				return yield* executeRequest(client, "POST", "/blocks", {
					blocks: transformedBlocks,
					position: {
						position: "end",
						pageId,
					},
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.insertBlocks", { attributes: { documentId } }),
			)

		const updateBlocks = (
			baseUrl: string,
			accessToken: string,
			documentId: string,
			blocks: ReadonlyArray<{ id: string; content?: string; style?: unknown }>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const transformedBlocks = blocks.map((block) => ({
					id: block.id,
					...(block.content !== undefined ? { markdown: block.content } : {}),
					...(block.style !== undefined ? { style: block.style } : {}),
				}))
				return yield* executeRequest(client, "PUT", "/blocks", { blocks: transformedBlocks })
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.updateBlocks", { attributes: { documentId } }),
			)

		const deleteBlocks = (
			baseUrl: string,
			accessToken: string,
			documentId: string,
			blockIds: ReadonlyArray<string>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "DELETE", "/blocks", {
					blockIds,
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.deleteBlocks", { attributes: { documentId } }),
			)

		const moveBlocks = (
			baseUrl: string,
			accessToken: string,
			documentId: string,
			blockIds: ReadonlyArray<string>,
			targetBlockId: string,
			position?: "before" | "after" | "inside",
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const destinationPosition =
					position === "inside"
						? {
								position: "end" as const,
								pageId: targetBlockId,
							}
						: {
								position: (position ?? "after") as "before" | "after",
								siblingId: targetBlockId,
							}

				return yield* executeRequest(client, "PUT", "/blocks/move", {
					blockIds,
					position: destinationPosition,
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.moveBlocks", { attributes: { documentId } }),
			)

		const searchBlocks = (baseUrl: string, accessToken: string, documentId: string, query: string) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const path = `/blocks/search?blockId=${encodeURIComponent(documentId)}&pattern=${encodeURIComponent(query)}`
				const raw = yield* executeRequest(client, "GET", path)
				return normalizeCraftItemsResponse(raw)
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.searchBlocks", { attributes: { documentId, query } }),
			)

		// ====================================================================
		// Documents
		// ====================================================================

		const listDocuments = (baseUrl: string, accessToken: string, folderId?: string) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const path = folderId ? `/documents?folderId=${encodeURIComponent(folderId)}` : "/documents"
				const raw = yield* executeRequest(client, "GET", path)
				const normalizedDocuments = normalizeCraftItemsResponse(raw)
				return yield* Schema.decodeUnknownEffect(Schema.Array(CraftDocument))(
					normalizedDocuments,
				).pipe(Effect.catch(() => Effect.succeed(normalizedDocuments as CraftDocument[])))
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.listDocuments"),
			)

		const searchDocuments = (baseUrl: string, accessToken: string, query: string) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const searchPath = `/documents/search?include=${encodeURIComponent(query)}`
				const raw = yield* executeRequest(client, "GET", searchPath)
				return normalizeCraftSearchDocumentsResponse(raw)
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.searchDocuments", { attributes: { query } }),
			)

		const createDocuments = (
			baseUrl: string,
			accessToken: string,
			documents: ReadonlyArray<{ title: string; folderId?: string; content?: string }>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const destinationFolderId = documents.find(
					(document) => document.folderId !== undefined,
				)?.folderId
				const createPayload = {
					documents: documents.map((document) => ({ title: document.title })),
					...(destinationFolderId ? { destination: { folderId: destinationFolderId } } : {}),
				}
				const created = yield* executeRequest(client, "POST", "/documents", createPayload)
				const createdItems = normalizeCraftItemsResponse(created)

				yield* Effect.forEach(
					documents.map((document, index) => ({
						content: document.content,
						documentId:
							createdItems[index] &&
							typeof createdItems[index] === "object" &&
							"id" in createdItems[index]
								? String((createdItems[index] as { id: unknown }).id)
								: undefined,
					})),
					(item) =>
						item.content && item.documentId
							? executeRequest(client, "POST", "/blocks", {
									markdown: item.content,
									position: {
										position: "end",
										pageId: item.documentId,
									},
								}).pipe(Effect.asVoid)
							: Effect.void,
					{ concurrency: 1 },
				)

				return created
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.createDocuments"),
			)

		const deleteDocuments = (baseUrl: string, accessToken: string, documentIds: ReadonlyArray<string>) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "DELETE", "/documents", { documentIds })
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.deleteDocuments"),
			)

		const moveDocuments = (
			baseUrl: string,
			accessToken: string,
			documentIds: ReadonlyArray<string>,
			targetFolderId: string,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "PUT", "/documents/move", {
					documentIds,
					destination: {
						folderId: targetFolderId,
					},
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.moveDocuments"),
			)

		// ====================================================================
		// Folders
		// ====================================================================

		const listFolders = (baseUrl: string, accessToken: string) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const raw = yield* executeRequest(client, "GET", "/folders")
				const normalizedFolders = normalizeCraftItemsResponse(raw)
				return yield* Schema.decodeUnknownEffect(Schema.Array(CraftFolder))(normalizedFolders).pipe(
					Effect.catch(() => Effect.succeed(normalizedFolders as CraftFolder[])),
				)
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.listFolders"),
			)

		const createFolders = (
			baseUrl: string,
			accessToken: string,
			folders: ReadonlyArray<{ title: string; parentId?: string }>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "POST", "/folders", {
					folders: folders.map((folder) => ({
						name: folder.title,
						...(folder.parentId ? { parentFolderId: folder.parentId } : {}),
					})),
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.createFolders"),
			)

		const deleteFolders = (baseUrl: string, accessToken: string, folderIds: ReadonlyArray<string>) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "DELETE", "/folders", { folderIds })
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.deleteFolders"),
			)

		const moveFolders = (
			baseUrl: string,
			accessToken: string,
			folderIds: ReadonlyArray<string>,
			targetParentId: string,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "PUT", "/folders/move", {
					folderIds,
					destination: {
						parentFolderId: targetParentId,
					},
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.moveFolders"),
			)

		// ====================================================================
		// Tasks
		// ====================================================================

		const getTasks = (
			baseUrl: string,
			accessToken: string,
			scope?: "inbox" | "active" | "upcoming" | "logbook",
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const resolvedScope = scope ?? "active"
				const path = `/tasks?scope=${resolvedScope}`
				const raw = yield* executeRequest(client, "GET", path)
				const normalizedTasks = normalizeCraftItemsResponse(raw)
				return yield* Schema.decodeUnknownEffect(Schema.Array(CraftTask))(normalizedTasks).pipe(
					Effect.catch(() => Effect.succeed(normalizedTasks as CraftTask[])),
				)
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.getTasks", { attributes: { scope: scope ?? "active" } }),
			)

		const createTasks = (
			baseUrl: string,
			accessToken: string,
			tasks: ReadonlyArray<{ content: string; documentId?: string }>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "POST", "/tasks", {
					tasks: tasks.map((task) => ({
						markdown: task.content,
						location: task.documentId
							? {
									type: "document",
									documentId: task.documentId,
								}
							: { type: "inbox" },
					})),
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.createTasks"),
			)

		const updateTasks = (
			baseUrl: string,
			accessToken: string,
			tasks: ReadonlyArray<{ id: string; content?: string; isDone?: boolean }>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "PUT", "/tasks", {
					tasksToUpdate: tasks.map((task) => ({
						id: task.id,
						...(task.content !== undefined ? { markdown: task.content } : {}),
						...(task.isDone !== undefined
							? { taskInfo: { state: task.isDone ? "done" : "todo" } }
							: {}),
					})),
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.updateTasks"),
			)

		const deleteTasks = (baseUrl: string, accessToken: string, taskIds: ReadonlyArray<string>) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "DELETE", "/tasks", { idsToDelete: taskIds })
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.deleteTasks"),
			)

		// ====================================================================
		// Collections
		// ====================================================================

		const listCollections = (baseUrl: string, accessToken: string) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const raw = yield* executeRequest(client, "GET", "/collections")
				const normalizedCollections = normalizeCraftItemsResponse(raw)
				return yield* Schema.decodeUnknownEffect(Schema.Array(CraftCollection))(
					normalizedCollections,
				).pipe(Effect.catch(() => Effect.succeed(normalizedCollections as CraftCollection[])))
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.listCollections"),
			)

		const getCollectionSchema = (baseUrl: string, accessToken: string, collectionId: string) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "GET", `/collections/${collectionId}/schema`)
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.getCollectionSchema", { attributes: { collectionId } }),
			)

		const getCollectionItems = (baseUrl: string, accessToken: string, collectionId: string) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				const raw = yield* executeRequest(client, "GET", `/collections/${collectionId}/items`)
				return normalizeCraftItemsResponse(raw)
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.getCollectionItems", { attributes: { collectionId } }),
			)

		const addCollectionItems = (
			baseUrl: string,
			accessToken: string,
			collectionId: string,
			items: ReadonlyArray<Record<string, unknown>>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "POST", `/collections/${collectionId}/items`, { items })
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.addCollectionItems", { attributes: { collectionId } }),
			)

		const updateCollectionItems = (
			baseUrl: string,
			accessToken: string,
			collectionId: string,
			items: ReadonlyArray<Record<string, unknown>>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "PUT", `/collections/${collectionId}/items`, {
					itemsToUpdate: items,
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.updateCollectionItems", { attributes: { collectionId } }),
			)

		const deleteCollectionItems = (
			baseUrl: string,
			accessToken: string,
			collectionId: string,
			itemIds: ReadonlyArray<string>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "DELETE", `/collections/${collectionId}/items`, {
					idsToDelete: itemIds,
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.deleteCollectionItems", { attributes: { collectionId } }),
			)

		// ====================================================================
		// Comments
		// ====================================================================

		const addComments = (
			baseUrl: string,
			accessToken: string,
			documentId: string,
			blockId: string,
			comments: ReadonlyArray<{ content: string }>,
		) =>
			Effect.gen(function* () {
				const client = makeClient(baseUrl, accessToken)
				return yield* executeRequest(client, "POST", "/comments", {
					comments: comments.map((comment) => ({
						blockId,
						content: comment.content,
					})),
				})
			}).pipe(
				Effect.retry({ schedule: makeRetrySchedule, while: isRetryableError }),
				Effect.withSpan("CraftApiClient.addComments", { attributes: { documentId, blockId } }),
			)

		return {
			// Connection
			getSpaceInfo,
			// Blocks
			getBlocks,
			insertBlocks,
			updateBlocks,
			deleteBlocks,
			moveBlocks,
			searchBlocks,
			// Documents
			listDocuments,
			searchDocuments,
			createDocuments,
			deleteDocuments,
			moveDocuments,
			// Folders
			listFolders,
			createFolders,
			deleteFolders,
			moveFolders,
			// Tasks
			getTasks,
			createTasks,
			updateTasks,
			deleteTasks,
			// Collections
			listCollections,
			getCollectionSchema,
			getCollectionItems,
			addCollectionItems,
			updateCollectionItems,
			deleteCollectionItems,
			// Comments
			addComments,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(FetchHttpClient.layer))
}
