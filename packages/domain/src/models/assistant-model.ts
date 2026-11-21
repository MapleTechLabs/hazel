/**
 * The AI panel's synced rows (`assistant_threads`, `assistant_items` in the `OrgObject`). Rows
 * are written only by the panel's RPCs and its engine; clients read them.
 */
import { AssistantItemId, AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import { Schema as S } from "effect"
import { JsonDate } from "./utils"

export const Visibility = S.Literals(["private", "organization"])
export type Visibility = typeof Visibility.Type

/** What runs the agent. Only the member's linked T3 Code for now. */
export const Engine = S.Literals(["t3code"])
export type Engine = typeof Engine.Type

/** `waiting`: the agent asked something, or needs an approval. */
export const ThreadStatus = S.Literals(["idle", "running", "waiting", "error"])
export type ThreadStatus = typeof ThreadStatus.Type

export const ItemKind = S.Literals([
	"user",
	"assistant",
	"reasoning",
	"tool",
	"question",
	"approval",
	"notice",
])
export type ItemKind = typeof ItemKind.Type

/** Something on the page the member was looking at. */
export const ContextEntity = S.Struct({
	/** `customer`, `channel`, `signal_rule`, ... */
	kind: S.String,
	id: S.String,
	name: S.optional(S.String),
})
export type ContextEntity = typeof ContextEntity.Type

/** Where the member was when they asked. */
export const Context = S.Struct({
	/** What the chip shows: "Acme · Billing". */
	label: S.String.check(S.isMaxLength(200)),
	/** The page's path in the app. */
	path: S.String.check(S.isMaxLength(500)),
	/** The route's tag, e.g. `CustomerDetail`. */
	route: S.String.check(S.isMaxLength(100)),
	entities: S.Array(ContextEntity).check(S.isMaxLength(10)),
})
export type Context = typeof Context.Type

export const Thread = S.Struct({
	id: AssistantThreadId,
	organizationId: OrganizationId,
	ownerId: UserId,
	title: S.String,
	visibility: Visibility,
	engine: Engine,
	status: ThreadStatus,
	errorMessage: S.NullOr(S.String),
	context: S.NullOr(Context),
	externalThreadId: S.NullOr(S.String),
	externalLink: S.NullOr(S.String),
	engineLabel: S.NullOr(S.String),
	lastActivityAt: JsonDate,
	createdAt: JsonDate,
	updatedAt: JsonDate,
	deletedAt: S.NullOr(JsonDate),
})
export type Thread = typeof Thread.Type

/** A question's choices, as the agent offered them. */
export const QuestionOption = S.Struct({ label: S.String, description: S.optional(S.String) })

export const Question = S.Struct({
	id: S.String,
	header: S.optional(S.String),
	question: S.String,
	options: S.optional(S.Array(QuestionOption)),
	multiSelect: S.optional(S.Boolean),
})
export type Question = typeof Question.Type

export const Item = S.Struct({
	id: AssistantItemId,
	threadId: AssistantThreadId,
	organizationId: OrganizationId,
	ownerId: UserId,
	visibility: Visibility,
	kind: ItemKind,
	externalId: S.NullOr(S.String),
	runId: S.NullOr(S.String),
	status: S.NullOr(S.String),
	title: S.NullOr(S.String),
	text: S.String,
	/** A `question`'s `{ questions: Question[], answered?: boolean }`; a `tool`'s `{ input }`. */
	data: S.NullOr(S.Record(S.String, S.Unknown)),
	authorId: S.NullOr(UserId),
	createdAt: JsonDate,
	updatedAt: JsonDate,
	deletedAt: S.NullOr(JsonDate),
})
export type Item = typeof Item.Type
