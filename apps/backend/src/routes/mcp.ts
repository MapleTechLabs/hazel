/**
 * Hazel's MCP server (`POST /mcp`, streamable HTTP, stateless JSON responses): lets a user's agent
 * read and answer messages for them. The agent authenticates with an OAuth access token or a
 * personal access token (`services/agent-access.ts`); a request without one gets 401 pointing at
 * the protected-resource metadata (`routes/agent-oauth.ts`), so clients can run the OAuth flow.
 *
 * Tools act as the user through the same object calls and HazelRpc methods the app uses, so the
 * user's own permissions apply; the grant's scope only decides which tools exist. Every call
 * carries the agent (`CurrentAgent`), so messages it writes are marked `message_agent_marks` and
 * chat shows "via <agent>" to the author's organization. Edits and deletes are limited to the
 * user's own messages.
 */
import { SQLite, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import { type AgentScope, DEFAULT_AGENT_SCOPES } from "@hazel/domain/http"
import {
	ChannelResponse,
	CreateThreadRequest,
	type MessageResponse,
	type MessageSearchPayload,
	type MessageSearchResponse,
} from "@hazel/domain/rpc"
import {
	type Account,
	type AccountDetail,
	type ContactRow,
	CustomersRange,
	type Event as CustomerEvent,
	HealthStatus,
	type Invoice,
	type Kpi,
	LifecycleStage,
	type OverviewResult,
	type Signal,
} from "@hazel/domain/customers"
import {
	AttachmentId,
	ChannelId,
	CustomerAccountId,
	MessageId,
	OrganizationId,
	type UserId,
} from "@hazel/schema"
import { isActiveContentType, MAX_ATTACHMENT_SIZE } from "@hazel/domain/http"
import { uuidv7 as randomUUIDv7 } from "@hazel/domain/uuid"
import { Context, DateTime, Effect, Option, Schema, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import type { HazelRpcTag } from "../rpc/dispatch"
import { resolveTarget } from "../rpc/routing"
import { formatMoney } from "../worker/objects/customers/facts"
import { AgentAccess, type AgentPrincipal } from "../services/agent-access"
import { createAttachmentInChannel } from "../services/attachment-uploads"
import { ObjectStorage } from "../services/object-storage"
import { Directory } from "../services/directory"
import { checkMessageRateLimit } from "../services/rate-limit-helpers"
import { callObject } from "../worker/objects/calls"
import {
	ListMessagesCall,
	MESSAGES_BY_IDS_MAX,
	MessagesByIdsCall,
	MessageThreadCall,
} from "../worker/objects/channel/api-messages"
import { forwardRpc } from "../worker/objects/forward"
import { channelTarget, orgTarget, userTarget } from "../worker/objects/kinds"
import { AgentChannelsCall } from "../worker/objects/org/agent"
import { providePrincipal } from "../worker/objects/principal"
import { AgentNotificationsCall } from "../worker/objects/user/agent"
import { agentOAuthConfig, protectedResourceMetadataUrl } from "./agent-oauth"

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"]
const MAX_CONTENT_LENGTH = 8000
/** The largest JSON-RPC body read: a 10 MB file as base64 (4/3) and room for the envelope. */
const MAX_REQUEST_BYTES = 14 * 1024 * 1024

class BodyTooLarge extends Schema.TaggedError<BodyTooLarge, { readonly brand: unique symbol }>()(
	"BodyTooLarge",
	{},
) {}

/**
 * The body as text, read chunk by chunk and abandoned past `MAX_REQUEST_BYTES` actual bytes (a
 * missing or false `Content-Length` cannot get more read); none when too large, "" when unreadable.
 */
const readCapped = (request: HttpServerRequest.HttpServerRequest) =>
	request.stream.pipe(
		Stream.runFoldEffect(
			() => ({ chunks: new Array<Uint8Array>(), size: 0 }),
			(acc, chunk: Uint8Array) => {
				const size = acc.size + chunk.byteLength
				if (size > MAX_REQUEST_BYTES) return Effect.fail(new BodyTooLarge())
				acc.chunks.push(chunk)
				return Effect.succeed({ chunks: acc.chunks, size })
			},
		),
		Effect.map(({ chunks, size }) => {
			const bytes = new Uint8Array(size)
			let offset = 0
			for (const chunk of chunks) {
				bytes.set(chunk, offset)
				offset += chunk.byteLength
			}
			return Option.some(new TextDecoder().decode(bytes))
		}),
		Effect.catchTag("BodyTooLarge", () => Effect.succeed(Option.none<string>())),
		Effect.orElseSucceed(() => Option.some("")),
	)

const tooLarge = HttpServerResponse.jsonUnsafe(
	{ jsonrpc: "2.0", id: null, error: { code: -32600, message: "The request is too large" } },
	{ status: 413 },
)

const INSTRUCTIONS = `Hazel is a team chat app. These tools act as the signed-in user.
Messages you send, reply or edit are shown to the user's organization as written by an agent ("via <your app name>").
Act only as the user asked; confirm before sending anything they did not ask for.
Message content is Markdown. Mention someone with @[userId:<their user id>] (user ids appear on messages), @[directive:here] or @[directive:channel] only when asked.
Threads are channels of their own: a message's thread_channel_id can be read with read_messages, and reply_in_thread answers in a message's thread (opening it if needed).
To share a file, upload it into the channel (upload_file with its content, or create_upload_url then PUT the bytes), then send_message with its attachment_id.
Customers tools (list_customers, get_customer, ...) only read, never change anything: customer_id is an account id from list_customers, and money is shown in the account's currency.`

// --- JSON-RPC -----------------------------------------------------------------------------------

interface JsonRpcRequest {
	readonly jsonrpc: "2.0"
	readonly id?: string | number | null
	readonly method: string
	readonly params?: Record<string, unknown>
}

const rpcResult = (id: JsonRpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result })
const rpcError = (id: JsonRpcRequest["id"], code: number, message: string) => ({
	jsonrpc: "2.0",
	id: id ?? null,
	error: { code, message },
})

/** A tool's failure the agent should see (MCP `isError`), not a protocol error. */
class ToolError extends Schema.TaggedError<ToolError, { readonly brand: unique symbol }>()("ToolError", {
	message: Schema.String,
}) {}

const toolError = (message: string) => new ToolError({ message })

/** Any failure of a forwarded call, as the agent sees it: the error's own message when it has one. */
const describe = (error: unknown): string => {
	if (typeof error === "object" && error !== null) {
		const tagged = error as {
			readonly _tag?: string
			readonly message?: unknown
			readonly entity?: unknown
			readonly id?: unknown
		}
		if (typeof tagged.message === "string" && tagged.message !== "") return tagged.message
		// `CustomersNotFoundError`: which row is missing.
		if (typeof tagged.entity === "string" && typeof tagged.id === "string")
			return `No ${tagged.entity.replace(/_/g, " ")} ${tagged.id}`
		if (typeof tagged._tag === "string")
			return tagged._tag.replace(/Error$/, "").replace(/([a-z])([A-Z])/g, "$1 $2")
	}
	return "The request failed"
}

// --- Tools --------------------------------------------------------------------------------------

interface ToolContext {
	readonly user: CurrentUser.Schema
	readonly agent: AgentPrincipal
	readonly storage: ObjectStorage["Service"]
}

interface Tool {
	readonly name: string
	readonly title: string
	readonly description: string
	/** The tool exists for a grant holding any of these. */
	readonly scopes: ReadonlyArray<AgentScope>
	readonly inputSchema: Record<string, unknown>
	readonly readOnly: boolean
	readonly run: (args: Record<string, unknown>, ctx: ToolContext) => Effect.Effect<unknown, ToolError, any>
}

const str = (description: string) => ({ type: "string", description })
const obj = (properties: Record<string, unknown>, required: ReadonlyArray<string> = []) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
})

const decodeChannelId = Schema.decodeUnknownOption(ChannelId)
const decodeMessageId = Schema.decodeUnknownOption(MessageId)
const decodeOrgId = Schema.decodeUnknownOption(OrganizationId)
const decodeAttachmentId = Schema.decodeUnknownOption(AttachmentId)
const decodeCallParams = Schema.decodeUnknownOption(
	Schema.Struct({
		name: Schema.String,
		arguments: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
	}),
)
/** A request body parsed as JSON, or none when it is not JSON. */
const parseJson = Schema.decodeOption(Schema.fromJsonString(Schema.Unknown))
/** How long a `create_upload_url` URL stays valid. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60

const argChannel = (args: Record<string, unknown>, key = "channel_id") =>
	Effect.fromOption(decodeChannelId(args[key]), () => toolError(`${key} must be a channel id (UUID)`))
const argMessage = (args: Record<string, unknown>, key = "message_id") =>
	Effect.fromOption(decodeMessageId(args[key]), () => toolError(`${key} must be a message id (UUID)`))
const optMessage = (args: Record<string, unknown>, key: string) =>
	args[key] === undefined || args[key] === null ? Effect.succeed(null) : argMessage(args, key)
const argContent = (args: Record<string, unknown>) => {
	const content = typeof args.content === "string" ? args.content.trim() : ""
	if (content === "") return Effect.fail(toolError("content must not be empty"))
	if (content.length > MAX_CONTENT_LENGTH)
		return Effect.fail(toolError(`content is longer than ${MAX_CONTENT_LENGTH} characters`))
	return Effect.succeed(content)
}
const argLimit = (args: Record<string, unknown>, fallback: number, max: number) => {
	const value = typeof args.limit === "number" ? Math.floor(args.limit) : fallback
	return Math.max(1, Math.min(value, max))
}

/** The channel's index row: its org and the `ChannelObject` holding its messages (a Connect mount's host). */
const channelInfo = (channelId: ChannelId) =>
	Effect.gen(function* () {
		const index = yield* (yield* Directory).channel(channelId).pipe(Effect.orDie)
		if (Option.isNone(index) || index.value.deletedAt !== null)
			return yield* toolError(`No channel ${channelId}`)
		return {
			organizationId: index.value.organizationId,
			host: channelTarget(index.value.hostChannelId ?? channelId),
		}
	})

/** Display names for user ids, from the directory. */
const namesOf = (ids: Iterable<string>) =>
	Effect.gen(function* () {
		const unique = [...new Set(ids)].slice(0, 100)
		if (unique.length === 0) return new Map<string, string>()
		const rows = yield* (yield* Directory).db
			.run(
				SQLite.from(schema.usersTable)
					.select("id", "firstName", "lastName")
					.where(($) => [$.id.in_(...(unique as Array<UserId>))]),
			)
			.pipe(Effect.orDie)
		return new Map(rows.map((row) => [row.id as string, `${row.firstName} ${row.lastName}`.trim()]))
	})

const MENTION = /@\[userId:([0-9a-f-]{36})\]/gi

interface MessageLike {
	readonly id: string
	readonly authorId: string
	readonly content: string
	readonly createdAt: Date | DateTime.Utc
	readonly updatedAt: Date | DateTime.Utc | null
	readonly replyToMessageId: string | null
	readonly threadChannelId: string | null
	readonly channelId: string
}

/** A message as a tool returns it. */
interface PresentedMessage {
	readonly id: string
	readonly channel_id: string
	readonly author: { readonly id: string; readonly name: string }
	readonly content: string
	readonly created_at: string
	edited_at?: string
	reply_to_message_id?: string
	thread_channel_id?: string
}

interface SentResult {
	readonly sent: true
	readonly message: PresentedMessage | undefined
	attachment_ids?: ReadonlyArray<AttachmentId>
}

interface ListedChannel {
	readonly id: string
	readonly organization_id: string
	readonly name: string
	readonly type: string
	readonly unread_count: number
	muted?: true
}

interface SearchResult {
	readonly results: ReadonlyArray<unknown>
	note?: string
}

/** `userPresenceStatus.update`'s payload, as far as `set_status` sets it. */
interface StatusUpdate {
	statusEmoji?: string | null
	customMessage?: string | null
	statusExpiresAt?: Date | null
}

interface StatusResult {
	cleared?: true
	presence?: (typeof PRESENCE)[number]
	emoji?: string | null
	message?: string | null
	expires_at?: string
}

/** Messages as the agent reads them: author names, mentions shown as `@Name (userId)`. */
const present = (messages: ReadonlyArray<MessageLike>) =>
	Effect.gen(function* () {
		const ids: Array<string> = []
		for (const message of messages) {
			ids.push(message.authorId)
			for (const match of message.content.matchAll(MENTION)) {
				const mentioned = match[1]
				if (mentioned !== undefined) ids.push(mentioned)
			}
		}
		const names = yield* namesOf(ids)
		const iso = (at: Date | DateTime.Utc) =>
			at instanceof Date ? at.toISOString() : DateTime.formatIso(at)
		const ms = (at: Date | DateTime.Utc) =>
			at instanceof Date ? at.getTime() : DateTime.toEpochMillis(at)
		return messages.map((message) => {
			const shown: PresentedMessage = {
				id: message.id,
				channel_id: message.channelId,
				author: { id: message.authorId, name: names.get(message.authorId) ?? "Unknown" },
				content: message.content.replace(
					MENTION,
					(whole, id: string) => `@${names.get(id) ?? "someone"} (${whole})`,
				),
				created_at: iso(message.createdAt),
			}
			if (message.updatedAt !== null && ms(message.updatedAt) > ms(message.createdAt))
				shown.edited_at = iso(message.updatedAt)
			if (message.replyToMessageId !== null) shown.reply_to_message_id = message.replyToMessageId
			if (message.threadChannelId !== null) shown.thread_channel_id = message.threadChannelId
			return shown
		})
	})

/** The user's own message in its channel; edits and deletes go no further. */
const ownMessage = (ctx: ToolContext, host: ReturnType<typeof channelTarget>, messageId: MessageId) =>
	Effect.gen(function* () {
		const found = yield* callObject(MessagesByIdsCall, host, {
			userId: ctx.user.id,
			ids: [messageId],
		}).pipe(Effect.mapError((error) => toolError(describe(error))))
		const message = found[0]
		if (message === undefined) return yield* toolError(`No message ${messageId} in this channel`)
		if (message.authorId !== ctx.user.id)
			return yield* toolError("Agents can only edit or delete the user's own messages")
		return message
	})

const forward = <A>(
	target: Parameters<typeof forwardRpc>[0],
	tag: Parameters<typeof forwardRpc>[1],
	payload: unknown,
) => forwardRpc<A, unknown>(target, tag, payload).pipe(Effect.mapError((error) => toolError(describe(error))))

const rateLimited = (ctx: ToolContext) =>
	checkMessageRateLimit(ctx.user.id).pipe(Effect.mapError((error) => toolError(describe(error))))

/** At most this many files on one message. */
const MAX_ATTACHMENTS = 10

const optAttachments = (args: Record<string, unknown>) => {
	const raw = args.attachment_ids
	if (raw === undefined || raw === null) return Effect.succeed<ReadonlyArray<AttachmentId>>([])
	if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS)
		return Effect.fail(toolError(`attachment_ids must be a list of at most ${MAX_ATTACHMENTS} ids`))
	const ids = raw.map((id) => decodeAttachmentId(id))
	if (ids.some(Option.isNone))
		return Effect.fail(toolError("attachment_ids must be attachment ids (UUIDs)"))
	return Effect.succeed(ids.map((id) => Option.getOrThrow(id)))
}

const sendIn = (
	ctx: ToolContext,
	channelId: ChannelId,
	content: string,
	replyToMessageId: MessageId | null,
	attachmentIds: ReadonlyArray<AttachmentId> = [],
	knownHost?: ReturnType<typeof channelTarget>,
) =>
	Effect.gen(function* () {
		const host = knownHost ?? (yield* channelInfo(channelId)).host
		yield* rateLimited(ctx)
		// A presigned upload is finished once its file is in the bucket; mark it complete then.
		for (const id of attachmentIds) {
			const stored = yield* ctx.storage
				.storedSize(id)
				.pipe(Effect.mapError((error) => toolError(error.message)))
			if (Option.isNone(stored))
				return yield* toolError(`File ${id} is not uploaded yet: PUT it to its upload_url first`)
			// A presigned PUT does not bound the body: the limit is checked on what was stored.
			if (stored.value > MAX_ATTACHMENT_SIZE) {
				yield* forward(host, "attachment.fail", { id, channelId, reason: "Larger than 10 MB" }).pipe(
					Effect.ignore,
				)
				return yield* toolError(`File ${id} is larger than 10 MB`)
			}
			yield* forward(host, "attachment.complete", { id, channelId })
		}
		const response = yield* forward<MessageResponse>(host, "message.create", {
			channelId,
			content,
			authorId: ctx.user.id,
			deletedAt: null,
			embeds: null,
			replyToMessageId,
			threadChannelId: null,
			attachmentIds: [...attachmentIds],
		})
		const sent: SentResult = { sent: true, message: (yield* present([response.data]))[0] }
		if (attachmentIds.length > 0) sent.attachment_ids = attachmentIds
		return sent
	})

/** The content type a file is stored with; active types (HTML, SVG…) only as a download. */
const storedContentType = (fileName: string, given: unknown) => {
	const type = typeof given === "string" && given.trim() !== "" ? given.trim() : guessContentType(fileName)
	return isActiveContentType(type) ? "application/octet-stream" : type
}

const EXTENSION_TYPES = new Map([
	["png", "image/png"],
	["jpg", "image/jpeg"],
	["jpeg", "image/jpeg"],
	["gif", "image/gif"],
	["webp", "image/webp"],
	["pdf", "application/pdf"],
	["txt", "text/plain"],
	["md", "text/markdown"],
	["csv", "text/csv"],
	["json", "application/json"],
	["zip", "application/zip"],
	["mp4", "video/mp4"],
	["mov", "video/quicktime"],
	["mp3", "audio/mpeg"],
	["wav", "audio/wav"],
])

const guessContentType = (fileName: string) =>
	EXTENSION_TYPES.get(fileName.split(".").pop()?.toLowerCase() ?? "") ?? "application/octet-stream"

const argFileName = (args: Record<string, unknown>) => {
	const name = typeof args.file_name === "string" ? args.file_name.trim().replace(/[\\/]/g, "_") : ""
	if (name === "" || name.length > 255)
		return Effect.fail(toolError("file_name must be 1 to 255 characters"))
	return Effect.succeed(name)
}

/** The `uploading` row in the channel (the channel refuses a user who cannot see it). */
const startUpload = (ctx: ToolContext, channelId: ChannelId, fileName: string, fileSize: number) =>
	Effect.gen(function* () {
		if (fileSize < 1 || fileSize > MAX_ATTACHMENT_SIZE)
			return yield* toolError(`Files must be 1 byte to ${MAX_ATTACHMENT_SIZE / 1024 / 1024} MB`)
		const { organizationId } = yield* channelInfo(channelId)
		const id = AttachmentId.make(randomUUIDv7())
		yield* createAttachmentInChannel({
			id,
			organizationId,
			channelId,
			uploadedBy: ctx.user.id,
			fileName,
			fileSize,
		}).pipe(Effect.mapError((error) => toolError(describe(error))))
		return id
	})

const decodeBase64 = (value: string) => {
	try {
		return Option.some(Uint8Array.from(atob(value.replace(/\s+/g, "")), (char) => char.charCodeAt(0)))
	} catch {
		return Option.none<Uint8Array<ArrayBuffer>>()
	}
}

const PRESENCE = ["online", "idle", "dnd", "invisible"] as const
/** Names agents may still use for the statuses: `away` is Idle, `busy` is Do Not Disturb. */
const PRESENCE_ALIASES = [
	["away", "idle"],
	["busy", "dnd"],
] as const satisfies ReadonlyArray<readonly [string, (typeof PRESENCE)[number]]>

// --- Customers (read only) ----------------------------------------------------------------------

const decodeAccountId = Schema.decodeUnknownOption(CustomerAccountId)

const argOrg = (args: Record<string, unknown>) =>
	Effect.fromOption(decodeOrgId(args.organization_id), () =>
		toolError("organization_id must be an organization id (UUID) from list_organizations"),
	)
const argAccount = (args: Record<string, unknown>) =>
	Effect.fromOption(decodeAccountId(args.customer_id), () =>
		toolError("customer_id must be a customer id (UUID) from list_customers"),
	)
const optAccount = (args: Record<string, unknown>) =>
	args.customer_id === undefined || args.customer_id === null
		? Effect.succeed<CustomerAccountId | undefined>(undefined)
		: argAccount(args)
/** A page request: `limit` clamped, `cursor` as the previous answer's `next_cursor`. */
const pageArgs = (args: Record<string, unknown>, fallback: number): PageRequestPayload => {
	const page: PageRequestPayload = { limit: argLimit(args, fallback, 100) }
	if (typeof args.cursor === "string" && args.cursor !== "") page.cursor = args.cursor
	return page
}
/** A Customers page request (`PageRequest` in `@hazel/domain/customers`). */
interface PageRequestPayload {
	limit: number
	cursor?: string
}

/** `customers.accounts.list`'s payload, as far as `list_customers` fills it. */
interface AccountsListPayload extends PageRequestPayload {
	query?: string
	healthStatuses?: ReadonlyArray<HealthStatus>
	lifecycleStages?: ReadonlyArray<LifecycleStage>
}

/** `customers.signals.open` and `customers.events.list`: one account's, or the org's. */
interface TimelinePayload extends PageRequestPayload {
	accountId?: CustomerAccountId
	types?: ReadonlyArray<string>
}

/** `customers.account.detail`, `customers.contacts.list`, `customers.invoices.list`: one account's. */
interface AccountPayload {
	accountId: CustomerAccountId
	limit?: number
	cursor?: string
}

/** What a customers tool sends, besides the `organizationId` every Customers RPC takes. */
type CustomersReadPayload =
	| { readonly range: CustomersRange }
	| AccountsListPayload
	| TimelinePayload
	| AccountPayload

/** `customers.events.list`'s bounds on `types`. */
const MAX_EVENT_TYPES = 20
const MAX_EVENT_TYPE_LENGTH = 100

/** Event type prefixes: refused when out of bounds, never dropped (a dropped one widens the filter). */
const argEventTypes = (args: Record<string, unknown>) => {
	const raw = args.types
	if (raw === undefined || raw === null) return Effect.succeed<ReadonlyArray<string>>([])
	if (
		!Array.isArray(raw) ||
		raw.length > MAX_EVENT_TYPES ||
		!raw.every((type) => typeof type === "string" && type !== "" && type.length <= MAX_EVENT_TYPE_LENGTH)
	)
		return Effect.fail(
			toolError(
				`types must be a list of at most ${MAX_EVENT_TYPES} prefixes, each 1 to ${MAX_EVENT_TYPE_LENGTH} characters`,
			),
		)
	return Effect.succeed<ReadonlyArray<string>>(raw)
}

/** One literal or a list of them, each one of `allowed`; none given is undefined. */
const optLiterals = <L extends string>(
	args: Record<string, unknown>,
	key: string,
	allowed: ReadonlyArray<L>,
) => {
	const raw = args[key]
	if (raw === undefined || raw === null) return Effect.succeed<ReadonlyArray<L> | undefined>(undefined)
	const values: ReadonlyArray<unknown> = Array.isArray(raw) ? raw : [raw]
	const known = values.filter((value): value is L => allowed.includes(value as L))
	if (known.length !== values.length)
		return Effect.fail(toolError(`${key} must be one or more of ${allowed.join(", ")}`))
	return Effect.succeed<ReadonlyArray<L> | undefined>(known)
}

const isoOf = (at: Date | DateTime.Utc | null | undefined) =>
	at === null || at === undefined ? null : at instanceof Date ? at.toISOString() : DateTime.formatIso(at)

/** Minor units as the currency writes them, e.g. `$1,234.50`. */
const money = formatMoney

/** The object without its null, undefined and empty-list fields: less for the agent to read. */
const compact = (value: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(value).filter(
			([, field]) =>
				field !== null && field !== undefined && !(Array.isArray(field) && field.length === 0),
		),
	)

/**
 * A Customers read RPC as the user, the way the app calls it: routed like the RPC (members of the
 * organization only, `rpc/routing.ts`), then run in the org's `CustomersObject`, whose handler
 * authorizes the user again (`customer_members`).
 */
const customersRead = <A>(
	ctx: ToolContext,
	tag: HazelRpcTag,
	organizationId: OrganizationId,
	payload: CustomersReadPayload,
) =>
	Effect.gen(function* () {
		const full = { ...payload, organizationId }
		const target = yield* resolveTarget(tag, full, ctx.user).pipe(
			Effect.catchTags({
				RouteRefusedError: () =>
					Effect.fail(toolError("The user is not a member of this organization")),
				RoutingError: (error) => Effect.fail(toolError(error.message)),
				DatabaseError: (error) =>
					Effect.logError("MCP customers routing failed", { error: error.message }).pipe(
						Effect.andThen(Effect.fail(toolError("Hazel is unavailable; try again shortly"))),
					),
			}),
		)
		if (target.kind !== "customers") return yield* toolError(`${tag} is not a Customers read`)
		return yield* forward<A>(target, tag, full)
	})

const customerRow = (account: Account) =>
	compact({
		id: account.id,
		name: account.name,
		domains: account.domains,
		plan: account.planName,
		mrr: money(account.mrrMinor, account.currency),
		lifecycle_stage: account.lifecycleStage,
		health: account.healthStatus,
		health_score: account.healthScore,
		last_active_at: isoOf(account.lastActiveAt),
		active_users_30d: account.activeUsers30d,
		open_risks: account.openRiskHigh + account.openRiskMedium + account.openRiskLow,
		open_opportunities: account.openOpportunities || null,
		environment: account.environment,
		primary_customer_id: account.primaryAccountId,
	})

const signalRow = (signal: Signal) =>
	compact({
		id: signal.id,
		customer_id: signal.accountId,
		kind: signal.kind,
		severity: signal.severity,
		status: signal.status,
		title: signal.title,
		reason: signal.reason === "" ? null : signal.reason,
		opened_at: isoOf(signal.openedAt),
		snoozed_until: isoOf(signal.snoozedUntil),
		assignee_user_id: signal.assigneeUserId,
	})

const invoiceRow = (invoice: Invoice) =>
	compact({
		id: invoice.id,
		number: invoice.number,
		status: invoice.status,
		provider: invoice.provider,
		amount_due: money(invoice.amountDueMinor, invoice.currency),
		amount_paid: money(invoice.amountPaidMinor, invoice.currency),
		issued_at: isoOf(invoice.issuedAt),
		due_at: isoOf(invoice.dueAt),
		paid_at: isoOf(invoice.paidAt),
		attempt_count: invoice.attemptCount || null,
		next_retry_at: isoOf(invoice.nextRetryAt),
		decline_reason: invoice.declineReason,
		url: invoice.hostedUrl,
	})

const contactRow = (row: ContactRow) =>
	compact({
		id: row.contact.id,
		name: row.contact.name,
		email: row.contact.email,
		title: row.contact.title,
		role: row.contact.role,
		billing_contact: row.contact.isBillingContact || null,
		status: row.status,
		active_days_30d: row.activity.filter((point) => point.value > 0).length,
		sign_ins_30d: row.contact.signInCount30d,
		events_30d: row.contact.eventCount30d,
		last_seen_at: isoOf(row.contact.lastSeenAt),
	})

const eventRow = (event: CustomerEvent) =>
	compact({
		occurred_at: isoOf(event.occurredAt),
		customer_id: event.accountId,
		provider: event.provider,
		type: event.type,
		title: event.title,
		contact_id: event.contactId,
	})

/** A Customers history page (`Page` in `@hazel/domain/customers`). */
interface PageOf<A> {
	readonly items: ReadonlyArray<A>
	readonly nextCursor: string | null
}

/** A page as a tool answers it: the list always (empty too), `next_cursor` only when there is more. */
const pageOut = <A, R>(key: string, page: PageOf<A>, row: (a: A) => R) =>
	page.nextCursor === null
		? { [key]: page.items.map(row) }
		: { [key]: page.items.map(row), next_cursor: page.nextCursor }

const customerDetail = (detail: AccountDetail, signals: PageOf<Signal>) => {
	const { account } = detail
	// Only recorded scores: the chart series holds 0 for a day never scored, which is unknown.
	const recorded = new Map((detail.healthScores ?? []).map((point) => [point.day, point.score]))
	const healthAt = (daysAgo: number) => {
		const day = detail.healthSeries[detail.healthSeries.length - 1 - daysAgo]?.day
		return day === undefined ? null : (recorded.get(day) ?? null)
	}
	return {
		customer: compact({
			...customerRow(account),
			lifecycle_stage_set_by_hand: account.lifecycleStageOverride === null ? null : true,
			owner_user_id: account.ownerUserId,
			tags: account.tags,
			seats_used: account.seatsUsed,
			seats_limit: account.seatsLimit,
			contact_count: account.contactCount,
			active_users_trend_pct: account.activeUsersTrendPct,
			first_seen_at: isoOf(account.firstSeenAt),
			customer_since: isoOf(account.customerSince),
			trial_ends_at: isoOf(account.trialEndsAt),
			churned_at: isoOf(account.churnedAt),
			champion_inactive_since: isoOf(account.championInactiveSince),
			left_out_of_needs_attention: account.attentionMutedAt === null ? null : true,
		}),
		health: compact({
			status: account.healthStatus,
			score: account.healthScore,
			updated_at: isoOf(account.healthUpdatedAt),
			score_7d_ago: healthAt(7),
			score_30d_ago: healthAt(30),
			score_90d_ago: healthAt(89),
			components: detail.health?.components.map((component) =>
				compact({
					key: component.key,
					score: component.score,
					weight_pct: Math.round(component.effectiveWeight),
					excluded: component.excluded || null,
					why: component.why,
				}),
			),
		}),
		/** Daily active users, oldest first, the last 30 days. */
		active_users_30d_daily: detail.activeUsersSeries.map((point) => point.value),
		open_signals: signals.items.map(signalRow),
		// Left out (undefined) when every open signal is shown.
		more_open_signals:
			signals.nextCursor === null
				? undefined
				: `Not all shown: call list_customer_signals with this customer_id and cursor "${signals.nextCursor}" for the rest`,
		subscriptions: detail.subscriptions.map((sub) =>
			compact({
				plan: sub.planName,
				status: sub.status,
				provider: sub.provider,
				mrr: money(sub.mrrMinor, sub.currency),
				interval: sub.interval,
				quantity: sub.quantity,
				started_at: isoOf(sub.startedAt),
				trial_ends_at: isoOf(sub.trialEndsAt),
				current_period_end: isoOf(sub.currentPeriodEnd),
				cancels_at_period_end: sub.cancelAtPeriodEnd || null,
				canceled_at: isoOf(sub.canceledAt),
				cancellation_reason: sub.cancellationReason,
			}),
		),
		upcoming_invoice: detail.upcomingInvoice === null ? null : invoiceRow(detail.upcomingInvoice),
		open_invoices: detail.openInvoices.map(invoiceRow),
		company: account.companyProfile === null ? null : compact({ ...account.companyProfile, colors: [] }),
		contacts_to_reach: detail.contactsToReach.map(contactRow),
		recent_events: detail.recentEvents.map(eventRow),
		links: detail.refs.flatMap((ref) =>
			ref.externalUrl === null ? [] : [{ provider: ref.provider, url: ref.externalUrl }],
		),
	}
}

const kpiOut = (kpi: Kpi | null, currency?: string) =>
	kpi === null
		? null
		: compact({
				value: currency === undefined ? kpi.value : money(kpi.value, currency),
				previous:
					kpi.previous === null || currency === undefined
						? kpi.previous
						: money(kpi.previous, currency),
				change_pct: kpi.deltaPct,
			})

const overviewOut = (overview: OverviewResult) => {
	const { currency, kpis } = overview
	const movement = (key: "new" | "expansion" | "reactivation" | "contraction" | "churn" | "net") =>
		money(
			overview.mrrMovements.reduce((sum, bucket) => sum + bucket[key], 0),
			currency,
		)
	const brief = (row: OverviewResult["recentNew"][number]) =>
		compact({
			customer_id: row.accountId,
			name: row.name,
			plan: row.planName,
			mrr: money(row.mrrMinor, currency),
			at: isoOf(row.at),
		})
	const mover = (row: OverviewResult["topMovers"]["gainers"][number]) => ({
		customer_id: row.accountId,
		name: row.name,
		avg_daily_active_users: row.currentAvg,
		previous_avg: row.previousAvg,
		change_pct: row.changePct,
	})
	return {
		range: overview.range,
		/** Every amount below: the organization's reporting currency, not each customer's own. */
		reporting_currency: currency,
		has_billing_data: overview.hasData.billing,
		has_activity_data: overview.hasData.activity,
		kpis: compact({
			mrr: kpiOut(kpis.mrrMinor, currency),
			paying_customers: kpiOut(kpis.payingCustomers),
			active_customers: kpiOut(kpis.activeCustomers),
			weekly_active_users: kpiOut(kpis.wau),
			monthly_active_users: kpiOut(kpis.mau),
			revenue_collected: kpiOut(kpis.revenueMinor, currency),
			churned_customers: kpiOut(kpis.logoChurn),
			mrr_at_high_risk: kpiOut(kpis.atRiskMrrMinor, currency),
			net_revenue_retention_pct: kpiOut(kpis.nrrPct),
		}),
		// Without billing data there were no movements to measure: none, not zeros.
		mrr_movements: overview.hasData.billing
			? {
					new: movement("new"),
					expansion: movement("expansion"),
					reactivation: movement("reactivation"),
					contraction: movement("contraction"),
					churn: movement("churn"),
					net: movement("net"),
				}
			: null,
		health: overview.healthDistribution.map((row) => ({
			status: row.status,
			customers: row.count,
			mrr: money(row.mrrMinor, currency),
		})),
		usage_gainers: overview.topMovers.gainers.map(mover),
		usage_decliners: overview.topMovers.decliners.map(mover),
		recent_churn: overview.recentChurn.map(brief),
		recent_new: overview.recentNew.map(brief),
		new_trials: overview.newTrials.map((trial) => ({ ...brief(trial), status: trial.status })),
	}
}

const orgArg = str("The organization, from list_organizations")
const pageSchema = (fallback: number) => ({
	limit: { type: "integer", minimum: 1, maximum: 100, description: `How many (default ${fallback})` },
	cursor: str("next_cursor from the previous page"),
})

const customerTools: ReadonlyArray<Tool> = [
	{
		name: "customers_overview",
		title: "Customers overview",
		description:
			"An organization's customer KPIs over a range: MRR, paying and active customers, churn, revenue, net retention, MRR movements, health distribution, biggest usage gainers and decliners, recent churn, new customers and trials. Amounts are in the organization's reporting currency; has_billing_data and has_activity_data say which data exists.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				range: { type: "string", enum: [...CustomersRange.literals], description: "Default 30d" },
			},
			["organization_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const range = (yield* optLiterals(args, "range", CustomersRange.literals))?.[0] ?? "30d"
				return overviewOut(
					yield* customersRead<OverviewResult>(ctx, "customers.overview", organizationId, {
						range,
					}),
				)
			}),
	},
	{
		name: "list_customers",
		title: "List customers",
		description:
			"An organization's customer accounts, highest MRR first: plan, MRR, lifecycle stage, health, last activity and open risk count. Filter by name or domain, health or lifecycle stage.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				query: str("Name or domain contains this"),
				health: {
					type: "array",
					items: { type: "string", enum: [...HealthStatus.literals] },
					description: "Only these health statuses",
				},
				lifecycle_stage: {
					type: "array",
					items: { type: "string", enum: [...LifecycleStage.literals] },
					description: "Only these lifecycle stages",
				},
				...pageSchema(25),
			},
			["organization_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const healthStatuses = yield* optLiterals(args, "health", HealthStatus.literals)
				const lifecycleStages = yield* optLiterals(args, "lifecycle_stage", LifecycleStage.literals)
				const query = typeof args.query === "string" ? args.query.trim().slice(0, 200) : ""
				const payload: AccountsListPayload = pageArgs(args, 25)
				if (query !== "") payload.query = query
				if (healthStatuses !== undefined) payload.healthStatuses = healthStatuses
				if (lifecycleStages !== undefined) payload.lifecycleStages = lifecycleStages
				const page = yield* customersRead<PageOf<Account>>(
					ctx,
					"customers.accounts.list",
					organizationId,
					payload,
				)
				return pageOut("customers", page, customerRow)
			}),
	},
	{
		name: "get_customer",
		title: "Get customer",
		description:
			"One customer in full: health score and why, usage trend, open risks and opportunities, subscriptions, upcoming and unpaid invoices, company profile, who to reach, recent activity and links to the billing and auth providers.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj({ organization_id: orgArg, customer_id: str("The customer, from list_customers") }, [
			"organization_id",
			"customer_id",
		]),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* argAccount(args)
				const detail = yield* customersRead<AccountDetail>(
					ctx,
					"customers.account.detail",
					organizationId,
					{
						accountId,
					},
				)
				const signals = yield* customersRead<PageOf<Signal>>(
					ctx,
					"customers.signals.open",
					organizationId,
					{
						accountId,
						limit: 20,
					},
				)
				return customerDetail(detail, signals)
			}),
	},
	{
		name: "list_customer_signals",
		title: "List customer signals",
		description:
			"Open risks and opportunities (the Needs attention queue), highest priority first: one customer's, or the whole organization's when customer_id is omitted.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{ organization_id: orgArg, customer_id: str("Only this customer's"), ...pageSchema(25) },
			["organization_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* optAccount(args)
				const payload: TimelinePayload = pageArgs(args, 25)
				if (accountId !== undefined) payload.accountId = accountId
				const page = yield* customersRead<PageOf<Signal>>(
					ctx,
					"customers.signals.open",
					organizationId,
					payload,
				)
				return pageOut("signals", page, signalRow)
			}),
	},
	{
		name: "list_customer_contacts",
		title: "List customer contacts",
		description:
			"A customer's people, most recently active first: title, role, billing contact, active / dormant / never active, and their activity over 30 days.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				customer_id: str("The customer, from list_customers"),
				...pageSchema(25),
			},
			["organization_id", "customer_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* argAccount(args)
				const page = yield* customersRead<PageOf<ContactRow>>(
					ctx,
					"customers.contacts.list",
					organizationId,
					{
						accountId,
						...pageArgs(args, 25),
					},
				)
				return pageOut("contacts", page, contactRow)
			}),
	},
	{
		name: "list_customer_events",
		title: "List customer events",
		description:
			"The activity timeline, newest first (billing, sign-ups, signals, notes...): one customer's, or the whole organization's when customer_id is omitted. types filters by type prefix, e.g. invoice. or signal.opened.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				customer_id: str("Only this customer's"),
				types: {
					type: "array",
					items: { type: "string", minLength: 1, maxLength: MAX_EVENT_TYPE_LENGTH },
					maxItems: MAX_EVENT_TYPES,
					description: `Type prefixes to keep (at most ${MAX_EVENT_TYPES}, each 1 to ${MAX_EVENT_TYPE_LENGTH} characters)`,
				},
				...pageSchema(25),
			},
			["organization_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* optAccount(args)
				const types = yield* argEventTypes(args)
				const payload: TimelinePayload = pageArgs(args, 25)
				if (accountId !== undefined) payload.accountId = accountId
				if (types.length > 0) payload.types = types
				const page = yield* customersRead<PageOf<CustomerEvent>>(
					ctx,
					"customers.events.list",
					organizationId,
					payload,
				)
				return pageOut("events", page, eventRow)
			}),
	},
	{
		name: "list_customer_invoices",
		title: "List customer invoices",
		description:
			"A customer's invoices, newest first: amounts due and paid, status, due and paid dates, failed payment attempts and decline reasons.",
		scopes: ["customers:read"],
		readOnly: true,
		inputSchema: obj(
			{
				organization_id: orgArg,
				customer_id: str("The customer, from list_customers"),
				...pageSchema(20),
			},
			["organization_id", "customer_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const organizationId = yield* argOrg(args)
				const accountId = yield* argAccount(args)
				const page = yield* customersRead<PageOf<Invoice>>(
					ctx,
					"customers.invoices.list",
					organizationId,
					{
						accountId,
						...pageArgs(args, 20),
					},
				)
				return pageOut("invoices", page, invoiceRow)
			}),
	},
]

const tools: ReadonlyArray<Tool> = [
	{
		name: "list_organizations",
		title: "List organizations",
		description: "The organizations (workspaces) the user belongs to.",
		scopes: ["messages:read", "customers:read"],
		readOnly: true,
		inputSchema: obj({}),
		run: (_args, ctx) =>
			Effect.gen(function* () {
				const directory = yield* Directory
				const ids = yield* directory.organizationsOf(ctx.user.id).pipe(Effect.orDie)
				const orgs = yield* Effect.forEach(ids, (id) => directory.org(id).pipe(Effect.orDie))
				return {
					organizations: orgs.flatMap((org) =>
						Option.isSome(org) && org.value.deletedAt === null
							? [{ id: org.value.id, name: org.value.name, slug: org.value.slug }]
							: [],
					),
				}
			}),
	},
	{
		name: "list_channels",
		title: "List channels",
		description:
			"Channels and direct messages the user can read, with unread counts. Omit organization_id to list every organization's.",
		scopes: ["messages:read"],
		readOnly: true,
		inputSchema: obj({ organization_id: str("Only this organization's channels") }),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const directory = yield* Directory
				const orgIds =
					args.organization_id === undefined
						? yield* directory.organizationsOf(ctx.user.id).pipe(Effect.orDie)
						: Option.match(decodeOrgId(args.organization_id), {
								onNone: () => [],
								onSome: (id) => [id],
							})
				if (orgIds.length === 0) return yield* toolError("No such organization")
				const lists = yield* Effect.forEach(orgIds, (organizationId) =>
					callObject(AgentChannelsCall, orgTarget(organizationId), { userId: ctx.user.id }).pipe(
						Effect.map((channels) => channels.map((channel) => ({ ...channel, organizationId }))),
						Effect.mapError((error) => toolError(describe(error))),
					),
				)
				return {
					channels: lists.flat().map((channel) => {
						const shown: ListedChannel = {
							id: channel.id,
							organization_id: channel.organizationId,
							name:
								channel.type === "direct" || channel.type === "single"
									? channel.members.join(", ") || channel.name
									: channel.name,
							type: channel.type,
							unread_count: channel.unreadCount,
						}
						if (channel.isMuted) shown.muted = true
						return shown
					}),
				}
			}),
	},
	{
		name: "read_messages",
		title: "Read messages",
		description:
			"A channel's (or thread's) messages, oldest first, newest at the end. Page back with before_message_id (the oldest id you have).",
		scopes: ["messages:read"],
		readOnly: true,
		inputSchema: obj(
			{
				channel_id: str("The channel or thread channel id"),
				limit: { type: "integer", minimum: 1, maximum: 100, description: "How many (default 30)" },
				before_message_id: str("Only messages older than this one"),
			},
			["channel_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const channelId = yield* argChannel(args)
				const before = yield* optMessage(args, "before_message_id")
				const { host } = yield* channelInfo(channelId)
				const page = yield* callObject(ListMessagesCall, host, {
					userId: ctx.user.id,
					channelId,
					startingAfter: before,
					endingBefore: null,
					limit: argLimit(args, 30, 100),
				}).pipe(Effect.mapError((error) => toolError(describe(error))))
				return {
					messages: yield* present([...page.messages].reverse()),
					has_older: page.hasMore,
				}
			}),
	},
	{
		name: "search_messages",
		title: "Search messages",
		description:
			"Full-text search over messages the user can read, newest first. Omit organization_id to search every organization.",
		scopes: ["messages:read"],
		readOnly: true,
		inputSchema: obj(
			{
				query: str("Words to find (all must appear, prefix match)"),
				organization_id: str("Only this organization"),
				channel_id: str("Only this channel"),
				limit: { type: "integer", minimum: 1, maximum: 50, description: "How many (default 20)" },
			},
			["query"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const query = typeof args.query === "string" ? args.query.slice(0, 500) : ""
				const limit = argLimit(args, 20, 50)
				const channelId = args.channel_id === undefined ? undefined : yield* argChannel(args)
				const directory = yield* Directory
				const orgIds =
					channelId !== undefined
						? [(yield* channelInfo(channelId)).organizationId]
						: args.organization_id !== undefined
							? Option.toArray(decodeOrgId(args.organization_id))
							: yield* directory.organizationsOf(ctx.user.id).pipe(Effect.orDie)
				const pages = yield* Effect.forEach(orgIds, (organizationId) => {
					const search: MessageSearchPayload =
						channelId === undefined
							? { organizationId, query, limit }
							: { organizationId, query, limit, channelId }
					return forward<MessageSearchResponse>(orgTarget(organizationId), "message.search", search)
				})
				const hits = pages
					.flatMap((page) => page.results)
					.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
					.slice(0, limit)
				const names = yield* namesOf(hits.map((hit) => hit.authorId))
				const found: SearchResult = {
					results: hits.map((hit) => ({
						message_id: hit.messageId,
						channel_id: hit.channelId,
						author: { id: hit.authorId, name: names.get(hit.authorId) ?? "Unknown" },
						created_at: hit.createdAt.toISOString(),
						snippet: hit.snippet,
					})),
				}
				if (pages.some((page) => page.indexing))
					found.note = "Search is still indexing; results may be incomplete"
				return found
			}),
	},
	{
		name: "list_notifications",
		title: "List notifications",
		description:
			"The user's notifications (mentions, replies, direct messages), newest first, with each message's content.",
		scopes: ["messages:read"],
		readOnly: true,
		inputSchema: obj({
			unread_only: { type: "boolean", description: "Only unread ones (default true)" },
			limit: { type: "integer", minimum: 1, maximum: 50, description: "How many (default 20)" },
		}),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const notifications = yield* callObject(AgentNotificationsCall, userTarget(ctx.user.id), {
					unreadOnly: args.unread_only !== false,
					limit: argLimit(args, 20, 50),
				}).pipe(Effect.mapError((error) => toolError(describe(error))))
				// The messages, one call per channel.
				const byChannel = new Map<ChannelId, Array<MessageId>>()
				for (const n of notifications) {
					if (n.channelId === null || n.messageId === null) continue
					const ids = byChannel.get(n.channelId) ?? []
					if (ids.length < MESSAGES_BY_IDS_MAX) ids.push(n.messageId)
					byChannel.set(n.channelId, ids)
				}
				const fetched = yield* Effect.forEach([...byChannel], ([channelId, ids]) =>
					channelInfo(channelId).pipe(
						Effect.flatMap(({ host }) =>
							callObject(MessagesByIdsCall, host, { userId: ctx.user.id, ids }),
						),
						// A channel the user lost access to, or a deleted one: its notifications show without content.
						Effect.orElseSucceed(() => []),
					),
				)
				const messages = new Map(
					(yield* present(fetched.flat())).map((message) => [message.id, message] as const),
				)
				return {
					notifications: notifications.map((n) => ({
						reason: n.reason,
						read: n.read,
						created_at: n.createdAt.toISOString(),
						channel_id: n.channelId,
						message:
							n.messageId === null ? null : (messages.get(n.messageId) ?? { id: n.messageId }),
					})),
				}
			}),
	},
	{
		name: "send_message",
		title: "Send message",
		description:
			"Post a message as the user in a channel, direct message or thread channel. Use reply_to_message_id to quote-reply a message inline.",
		scopes: ["messages:write"],
		readOnly: false,
		inputSchema: obj(
			{
				channel_id: str("Where to post"),
				content: str("Markdown text (may be empty when sending files)"),
				reply_to_message_id: str("Reply to this message (inline quote)"),
				attachment_ids: {
					type: "array",
					items: { type: "string" },
					maxItems: MAX_ATTACHMENTS,
					description:
						"Files to attach, from upload_file or create_upload_url in this same channel",
				},
			},
			["channel_id"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const channelId = yield* argChannel(args)
				const attachmentIds = yield* optAttachments(args)
				const content =
					attachmentIds.length > 0 && (args.content === undefined || args.content === "")
						? ""
						: yield* argContent(args)
				const replyTo = yield* optMessage(args, "reply_to_message_id")
				return yield* sendIn(ctx, channelId, content, replyTo, attachmentIds)
			}),
	},
	{
		name: "upload_file",
		title: "Upload file",
		description:
			"Upload a file (up to 10 MB) into a channel from its content: base64 for any file, or text for a text file. Returns an attachment_id; post it with send_message's attachment_ids. For large files or files on disk, use create_upload_url instead.",
		scopes: ["messages:write"],
		readOnly: false,
		inputSchema: obj(
			{
				channel_id: str("The channel (or thread channel) the file will be posted in"),
				file_name: str("The file's name, e.g. report.pdf"),
				content_base64: str("The file's bytes, base64-encoded"),
				text: str("The file's content as text (instead of content_base64)"),
				content_type: str("MIME type; guessed from the file name when omitted"),
			},
			["channel_id", "file_name"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const channelId = yield* argChannel(args)
				const fileName = yield* argFileName(args)
				const bytes =
					typeof args.content_base64 === "string"
						? yield* Effect.fromOption(decodeBase64(args.content_base64), () =>
								toolError("content_base64 is not valid base64"),
							)
						: typeof args.text === "string"
							? new TextEncoder().encode(args.text)
							: yield* toolError("Give content_base64 or text")
				// Text with no type and an unknown extension is plain text.
				const contentType = storedContentType(
					fileName,
					args.content_type ??
						(typeof args.content_base64 !== "string" &&
						guessContentType(fileName) === "application/octet-stream"
							? "text/plain"
							: undefined),
				)
				const id = yield* startUpload(ctx, channelId, fileName, bytes.byteLength)
				const { host } = yield* channelInfo(channelId)
				yield* ctx.storage.put(id, bytes as Uint8Array<ArrayBuffer>, contentType).pipe(
					Effect.tapError(() =>
						forward(host, "attachment.fail", { id, channelId, reason: "MCP upload failed" }).pipe(
							Effect.ignore,
						),
					),
					Effect.mapError((error) => toolError(error.message)),
				)
				yield* forward(host, "attachment.complete", { id, channelId })
				return {
					attachment_id: id,
					file_name: fileName,
					size: bytes.byteLength,
					content_type: contentType,
				}
			}),
	},
	{
		name: "create_upload_url",
		title: "Create upload URL",
		description:
			"For a file on disk or too big to inline (up to 10 MB): returns an upload_url valid for 15 minutes. PUT the raw bytes there with the given headers (e.g. curl -X PUT -H 'Content-Type: …' -H 'If-None-Match: *' --data-binary @file '<upload_url>'); the URL stores one file and cannot replace it, then post attachment_id with send_message's attachment_ids.",
		scopes: ["messages:write"],
		readOnly: false,
		inputSchema: obj(
			{
				channel_id: str("The channel (or thread channel) the file will be posted in"),
				file_name: str("The file's name, e.g. demo.mp4"),
				file_size: { type: "integer", minimum: 1, description: "Size in bytes" },
				content_type: str("MIME type; guessed from the file name when omitted"),
			},
			["channel_id", "file_name", "file_size"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const channelId = yield* argChannel(args)
				const fileName = yield* argFileName(args)
				const fileSize = typeof args.file_size === "number" ? Math.floor(args.file_size) : 0
				const contentType = storedContentType(fileName, args.content_type)
				const id = yield* startUpload(ctx, channelId, fileName, fileSize)
				const uploadUrl = yield* ctx.storage
					.presignPut(id, { contentType, expiresIn: UPLOAD_URL_TTL_SECONDS, createOnly: true })
					.pipe(Effect.mapError((error) => toolError(error.message)))
				return {
					attachment_id: id,
					upload_url: uploadUrl,
					method: "PUT",
					headers: { "Content-Type": contentType, "If-None-Match": "*" },
					expires_in_seconds: UPLOAD_URL_TTL_SECONDS,
				}
			}),
	},
	{
		name: "reply_in_thread",
		title: "Reply in thread",
		description: "Answer a message in its thread, opening the thread if it has none yet.",
		scopes: ["messages:write"],
		readOnly: false,
		inputSchema: obj(
			{
				channel_id: str("The channel the message is in"),
				message_id: str("The message to answer"),
				content: str("Markdown text"),
			},
			["channel_id", "message_id", "content"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const channelId = yield* argChannel(args)
				const messageId = yield* argMessage(args)
				const content = yield* argContent(args)
				const { host, organizationId } = yield* channelInfo(channelId)
				const existing = yield* callObject(MessageThreadCall, host, {
					userId: ctx.user.id,
					messageId,
				}).pipe(Effect.mapError((error) => toolError(describe(error))))
				const threadId =
					existing ??
					(yield* forward<ChannelResponse>(
						orgTarget(organizationId),
						"channel.createThread",
						new CreateThreadRequest({ messageId, channelId, organizationId }),
					)).data.id
				// A thread is a channel of its own object. A new one may not be in the directory yet
				// (its index row is published after `channel.createThread` answers), so no lookup.
				return {
					thread_channel_id: threadId,
					...(yield* sendIn(ctx, threadId, content, null, [], channelTarget(threadId))),
				}
			}),
	},
	{
		name: "edit_message",
		title: "Edit message",
		description: "Change the text of one of the user's own messages.",
		scopes: ["messages:write"],
		readOnly: false,
		inputSchema: obj(
			{
				channel_id: str("The message's channel"),
				message_id: str("The message"),
				content: str("New Markdown text"),
			},
			["channel_id", "message_id", "content"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const channelId = yield* argChannel(args)
				const messageId = yield* argMessage(args)
				const content = yield* argContent(args)
				const { host } = yield* channelInfo(channelId)
				yield* ownMessage(ctx, host, messageId)
				yield* rateLimited(ctx)
				const response = yield* forward<MessageResponse>(host, "message.update", {
					id: messageId,
					channelId,
					content,
				})
				return { edited: true, message: (yield* present([response.data]))[0] }
			}),
	},
	{
		name: "delete_message",
		title: "Delete message",
		description: "Delete one of the user's own messages. Ask the user first.",
		scopes: ["messages:write"],
		readOnly: false,
		inputSchema: obj({ channel_id: str("The message's channel"), message_id: str("The message") }, [
			"channel_id",
			"message_id",
		]),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const channelId = yield* argChannel(args)
				const messageId = yield* argMessage(args)
				const { host } = yield* channelInfo(channelId)
				yield* ownMessage(ctx, host, messageId)
				yield* rateLimited(ctx)
				yield* forward(host, "message.delete", { id: messageId, channelId })
				return { deleted: true }
			}),
	},
	{
		name: "set_status",
		title: "Set status",
		description:
			'Set the user\'s status: an emoji and message (e.g. 🌴 "Out until Monday"), optionally clearing itself after some minutes, and/or their presence (online, idle, dnd = do not disturb, invisible = appear offline). clear: true removes the emoji and message.',
		scopes: ["messages:write"],
		readOnly: false,
		inputSchema: obj({
			emoji: str("One emoji, e.g. 🌴"),
			message: str("Up to 100 characters"),
			expires_in_minutes: {
				type: "integer",
				minimum: 1,
				maximum: 43200,
				description: "Clear the status after this long",
			},
			presence: {
				type: "string",
				enum: [...PRESENCE],
				description: "online, idle, dnd (do not disturb) or invisible (appear offline)",
			},
			clear: { type: "boolean", description: "Remove the emoji and message" },
		}),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const target = userTarget(ctx.user.id)
				const presence =
					args.presence === undefined
						? undefined
						: (PRESENCE.find((value) => value === args.presence) ??
							PRESENCE_ALIASES.find(([alias]) => alias === args.presence)?.[1] ??
							(yield* toolError("presence must be online, idle, dnd or invisible")))
				if (args.clear === true) {
					yield* forward(target, "userPresenceStatus.clearStatus", {})
					if (presence !== undefined)
						yield* forward(target, "userPresenceStatus.setStatus", {
							status: presence,
							expiresAt: null,
						})
					const cleared: StatusResult = { cleared: true }
					if (presence !== undefined) cleared.presence = presence
					return cleared
				}
				const emoji =
					typeof args.emoji === "string" && args.emoji.trim() !== "" ? args.emoji.trim() : undefined
				const message =
					typeof args.message === "string" && args.message.trim() !== ""
						? args.message.trim()
						: undefined
				if (emoji !== undefined && emoji.length > 32)
					return yield* toolError("emoji must be one emoji")
				if (message !== undefined && message.length > 100)
					return yield* toolError("message must be at most 100 characters")
				if (emoji === undefined && message === undefined && presence === undefined)
					return yield* toolError("Give an emoji, a message, a presence, or clear: true")
				const minutes =
					typeof args.expires_in_minutes === "number"
						? Math.floor(args.expires_in_minutes)
						: undefined
				const expiresAt =
					minutes === undefined
						? null
						: new Date(Date.now() + Math.min(Math.max(minutes, 1), 43200) * 60_000)
				const custom = emoji !== undefined || message !== undefined
				const update: StatusUpdate = {}
				const result: StatusResult = {}
				if (presence !== undefined) {
					yield* forward(target, "userPresenceStatus.setStatus", {
						status: presence,
						expiresAt: null,
					})
					result.presence = presence
				}
				if (custom) {
					update.statusEmoji = emoji ?? null
					update.customMessage = message ?? null
					update.statusExpiresAt = expiresAt
					result.emoji = emoji ?? null
					result.message = message ?? null
					if (expiresAt !== null) result.expires_at = expiresAt.toISOString()
				}
				if (custom) yield* forward(target, "userPresenceStatus.update", update)
				return result
			}),
	},
	{
		name: "toggle_reaction",
		title: "Toggle reaction",
		description: "Add an emoji reaction as the user, or remove it if the user already reacted with it.",
		scopes: ["messages:write"],
		readOnly: false,
		inputSchema: obj(
			{
				channel_id: str("The message's channel"),
				message_id: str("The message"),
				emoji: str("A unicode emoji, e.g. 👍"),
			},
			["channel_id", "message_id", "emoji"],
		),
		run: (args, ctx) =>
			Effect.gen(function* () {
				const channelId = yield* argChannel(args)
				const messageId = yield* argMessage(args)
				const emoji = typeof args.emoji === "string" ? args.emoji.trim() : ""
				if (emoji === "" || emoji.length > 50) return yield* toolError("emoji must be one emoji")
				const { host } = yield* channelInfo(channelId)
				const response = yield* forward<{ readonly wasCreated: boolean }>(
					host,
					"messageReaction.toggle",
					{
						messageId,
						channelId,
						emoji,
					},
				)
				return { reacted: response.wasCreated }
			}),
	},
	...customerTools,
]

const allowed = (tool: Tool, scopes: ReadonlyArray<AgentScope>) =>
	tool.scopes.some((scope) => scopes.includes(scope))

const toolsFor = (scopes: ReadonlyArray<AgentScope>) => tools.filter((tool) => allowed(tool, scopes))

const toolListing = (scopes: ReadonlyArray<AgentScope>) =>
	toolsFor(scopes).map((tool) => ({
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: tool.inputSchema,
		annotations: {
			title: tool.title,
			readOnlyHint: tool.readOnly,
			destructiveHint: tool.name === "delete_message",
			openWorldHint: false,
		},
	}))

const callTool = (params: Record<string, unknown> | undefined, ctx: ToolContext) =>
	Effect.gen(function* () {
		const call = decodeCallParams(params)
		if (Option.isNone(call)) return yield* toolError("tools/call needs a tool name")
		const name = call.value.name
		const args = call.value.arguments ?? {}
		const tool = tools.find((candidate) => candidate.name === name)
		if (tool === undefined) return yield* toolError(`Unknown tool ${name}`)
		if (!allowed(tool, ctx.agent.scopes))
			return yield* toolError(
				tool.scopes.includes("messages:write")
					? `This connection is read-only; ${name} needs write access`
					: `This connection was not granted ${tool.scopes.join(" or ")}; ${name} needs it`,
			)
		return yield* tool.run(args, ctx).pipe(
			Effect.withSpan("Mcp.tool", {
				attributes: { "mcp.tool": name, "agent.grant_id": ctx.agent.grantId },
			}),
		)
	}).pipe(
		Effect.map((result) => ({
			content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			structuredContent: result,
		})),
		Effect.catchTag("ToolError", (error) =>
			Effect.succeed({ content: [{ type: "text", text: error.message }], isError: true }),
		),
	)

const handle = (request: JsonRpcRequest, ctx: ToolContext) =>
	Effect.gen(function* () {
		switch (request.method) {
			case "initialize": {
				const requested = request.params?.protocolVersion
				const protocolVersion =
					typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
						? requested
						: SUPPORTED_PROTOCOL_VERSIONS[0]
				return rpcResult(request.id, {
					protocolVersion,
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: "hazel", title: "Hazel", version: "1.0.0" },
					instructions: INSTRUCTIONS,
				})
			}
			case "ping":
				return rpcResult(request.id, {})
			case "tools/list":
				return rpcResult(request.id, { tools: toolListing(ctx.agent.scopes) })
			case "tools/call":
				return rpcResult(request.id, yield* callTool(request.params, ctx))
			default:
				return rpcError(request.id, -32601, `Method not found: ${request.method}`)
		}
	})

const isRequest = (value: unknown): value is JsonRpcRequest =>
	typeof value === "object" &&
	value !== null &&
	(value as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
	typeof (value as { method?: unknown }).method === "string"

/** A notification (no id) gets no answer. */
const isNotification = (request: JsonRpcRequest) => request.id === undefined

const loadUser = (userId: UserId) =>
	Effect.gen(function* () {
		const row = yield* (yield* Directory).db.first(
			SQLite.from(schema.usersTable)
				.select()
				// A user whose sign-in was deactivated loses their agents too.
				.where(($) => [$.id.eq(userId), $.deletedAt.isNull(), $.authActive.eq(true)]),
		)
		return Option.map(
			row,
			(user) =>
				new CurrentUser.Schema({
					id: user.id,
					role: "member",
					avatarUrl: user.avatarUrl ?? undefined,
					firstName: user.firstName,
					lastName: user.lastName,
					email: user.email,
					isOnboarded: user.isOnboarded,
					timezone: user.timezone,
					settings: user.settings,
				}),
		)
	})

export const McpRoute = HttpRouter.use((router) =>
	Effect.gen(function* () {
		const access = yield* AgentAccess
		const storage = yield* ObjectStorage
		// A route handler runs in the request's context, not the layer's: on the Worker that holds
		// none of the services the tools reach (`Directory`, `ObjectStubs`, the rate limiter), so the
		// layer's are captured here and laid under each request's.
		const services = yield* Effect.context<never>()
		const { apiOrigin } = yield* agentOAuthConfig
		const unauthorized = (description: string) =>
			HttpServerResponse.jsonUnsafe(
				{ error: "invalid_token", error_description: description },
				{
					status: 401,
					headers: {
						"WWW-Authenticate": `Bearer resource_metadata="${protectedResourceMetadataUrl(apiOrigin)}", scope="${DEFAULT_AGENT_SCOPES.join(" ")}", error="invalid_token"`,
					},
				},
			)

		const notAllowed = Effect.succeed(
			HttpServerResponse.text("This MCP server answers POST only", {
				status: 405,
				headers: { Allow: "POST" },
			}),
		)
		yield* router.add("GET", "/mcp", notAllowed)
		yield* router.add("DELETE", "/mcp", notAllowed)

		yield* router.add(
			"POST",
			"/mcp",
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const authorization = request.headers.authorization ?? ""
				const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : ""
				if (token === "") return unauthorized("Sign in to use Hazel")
				const agent = yield* access.authenticate(token)
				if (Option.isNone(agent)) return unauthorized("The token is invalid, expired or revoked")
				const user = yield* loadUser(agent.value.userId)
				if (Option.isNone(user)) return unauthorized("The user is gone")
				yield* Effect.annotateCurrentSpan({
					"agent.grant_id": agent.value.grantId,
					"user.id": user.value.id,
				})

				// `upload_file` carries a file of up to 10 MB as base64; nothing larger is read.
				const declared = Number(request.headers["content-length"] ?? "0")
				if (declared > MAX_REQUEST_BYTES) return tooLarge
				const body = yield* readCapped(request)
				if (Option.isNone(body)) return tooLarge
				const json = parseJson(body.value)
				if (Option.isNone(json)) {
					return HttpServerResponse.jsonUnsafe(rpcError(null, -32700, "Parse error"), {
						status: 400,
					})
				}
				const parsed = json.value
				const batch = Array.isArray(parsed)
				const items = (batch ? parsed : [parsed]) as ReadonlyArray<unknown>
				const ctx: ToolContext = { user: user.value, agent: agent.value, storage }
				const principal = {
					user: user.value,
					botScopes: null,
					agent: { grantId: agent.value.grantId, name: agent.value.name },
				}
				const responses = yield* Effect.forEach(items, (item) =>
					!isRequest(item)
						? Effect.succeed(rpcError(null, -32600, "Invalid request"))
						: isNotification(item)
							? Effect.succeed(null)
							: handle(item, ctx).pipe(
									providePrincipal(principal),
									Effect.provideService(CurrentUser.Context, user.value),
								),
				)
				const answers = responses.filter((response) => response !== null)
				if (answers.length === 0) return HttpServerResponse.empty({ status: 202 })
				return HttpServerResponse.jsonUnsafe(batch ? answers : answers[0], {
					headers: { "Cache-Control": "no-store" },
				})
			}).pipe(
				Effect.catchTag("DatabaseError", (error) =>
					Effect.logError("MCP request failed", { error: error.message }).pipe(
						Effect.as(
							HttpServerResponse.jsonUnsafe(rpcError(null, -32603, "Hazel is unavailable"), {
								status: 503,
							}),
						),
					),
				),
				Effect.withSpan("Mcp.request"),
				Effect.updateContext((request: Context.Context<HttpServerRequest.HttpServerRequest>) =>
					Context.merge(services, request),
				),
			),
		)
	}),
)
