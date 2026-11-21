/**
 * The AI panel: a member talks to an agent about what they are looking at. Threads and their
 * items sync from the `OrgObject` (`assistant_threads`, `assistant_items`); these calls start and
 * steer them. Only the owner writes to a thread; a shared one is read-only to the rest of the org.
 */
import { AssistantItemId, AssistantThreadId, OrganizationId, TransactionId } from "@hazel/schema"
import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import * as Assistant from "../models/assistant-model"
import { RequiredScopes } from "../scopes/required-scopes"
import { AuthMiddleware } from "./middleware"

export class AssistantThreadNotFoundError extends Schema.TaggedError<
	AssistantThreadNotFoundError,
	{ readonly brand: unique symbol }
>()("AssistantThreadNotFoundError", { threadId: AssistantThreadId }) {}

/**
 * The engine could not take the message. `not_connected`/`expired`: link T3 Code (or add an API
 * key) again; `unreachable`: the machine is asleep, T3 Code is closed, or the provider is down;
 * `refused`: the engine said no.
 */
export class AssistantEngineError extends Schema.TaggedError<
	AssistantEngineError,
	{ readonly brand: unique symbol }
>()("AssistantEngineError", {
	reason: Schema.Literals(["not_connected", "expired", "unreachable", "refused"]),
	message: Schema.String,
}) {}

/** The question was answered already, or is no longer open. */
export class AssistantQuestionClosedError extends Schema.TaggedError<
	AssistantQuestionClosedError,
	{ readonly brand: unique symbol }
>()("AssistantQuestionClosedError", { itemId: AssistantItemId }) {}

const Message = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20_000))

/** The provider refused the API key (checked with a cheap call before it is saved). */
export class AssistantKeyRejectedError extends Schema.TaggedError<
	AssistantKeyRejectedError,
	{ readonly brand: unique symbol }
>()("AssistantKeyRejectedError", { provider: Assistant.HostedProvider, message: Schema.String }) {}

/** A hosted engine: whether the member saved a key for it, and the model it runs. */
export const HostedEngineStatus = Schema.Struct({
	state: Schema.Literals(["connected", "not_connected"]),
	model: Schema.String,
})
export type HostedEngineStatus = typeof HostedEngineStatus.Type

/**
 * Whether the member can talk to the agent, and where it runs: T3 Code, and the hosted engines
 * with their own key. `preferredEngine` starts new chats: their choice, else the first connected
 * one; null when none is.
 */
export const AssistantStatus = Schema.Struct({
	t3code: Schema.Struct({
		state: Schema.Literals(["connected", "not_connected", "expired"]),
		environmentLabel: Schema.NullOr(Schema.String),
	}),
	anthropic: HostedEngineStatus,
	openai: HostedEngineStatus,
	preferredEngine: Schema.NullOr(Assistant.Engine),
})
export type AssistantStatus = typeof AssistantStatus.Type

/** An API key as typed: never stored in clear, never returned, never synced. */
const ApiKey = Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(500))

export const AssistantWriteResponse = Schema.Struct({
	threadId: AssistantThreadId,
	transactionId: TransactionId,
})

const writeErrors = Schema.Union([
	AssistantThreadNotFoundError,
	AssistantEngineError,
	UnauthorizedError,
	InternalServerError,
])

export class AssistantRpcs extends RpcGroup.make(
	Rpc.make("assistant.status", {
		payload: Schema.Struct({ organizationId: OrganizationId }),
		success: AssistantStatus,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["assistant:read"])
		.middleware(AuthMiddleware),

	/**
	 * Save the member's own API key for a hosted engine (checked with the provider first, stored
	 * encrypted), and make that engine the one new chats use.
	 */
	Rpc.make("assistant.saveKey", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			provider: Assistant.HostedProvider,
			apiKey: ApiKey,
		}),
		success: AssistantStatus,
		error: Schema.Union([
			AssistantKeyRejectedError,
			AssistantEngineError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["assistant:write"])
		.middleware(AuthMiddleware),

	/** Forget the member's key for a hosted engine. Its chats stay; continuing them needs a key again. */
	Rpc.make("assistant.removeKey", {
		payload: Schema.Struct({ organizationId: OrganizationId, provider: Assistant.HostedProvider }),
		success: AssistantStatus,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["assistant:write"])
		.middleware(AuthMiddleware),

	/** The engine new chats start on. It must be connected. */
	Rpc.make("assistant.setEngine", {
		payload: Schema.Struct({ organizationId: OrganizationId, engine: Assistant.Engine }),
		success: AssistantStatus,
		error: Schema.Union([AssistantEngineError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["assistant:write"])
		.middleware(AuthMiddleware),

	/** A new thread (its id made by the client) with its first message, on the preferred engine. */
	Rpc.make("assistant.start", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			threadId: AssistantThreadId,
			message: Message,
			context: Schema.NullOr(Assistant.Context),
		}),
		success: AssistantWriteResponse,
		error: writeErrors,
	})
		.annotate(RequiredScopes, ["assistant:write"])
		.middleware(AuthMiddleware),

	/**
	 * A follow-up on the thread's own engine: queued behind the current run if one is going.
	 * `messageId` (client-made) makes a retry send once.
	 */
	Rpc.make("assistant.send", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			threadId: AssistantThreadId,
			messageId: AssistantItemId,
			message: Message,
			context: Schema.NullOr(Assistant.Context),
		}),
		success: AssistantWriteResponse,
		error: writeErrors,
	})
		.annotate(RequiredScopes, ["assistant:write"])
		.middleware(AuthMiddleware),

	/** Answer the agent's question (a `question` item), one answer per question id. */
	Rpc.make("assistant.answer", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			threadId: AssistantThreadId,
			itemId: AssistantItemId,
			answers: Schema.Record(Schema.String, Schema.String),
		}),
		success: AssistantWriteResponse,
		error: Schema.Union([
			AssistantThreadNotFoundError,
			AssistantQuestionClosedError,
			AssistantEngineError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["assistant:write"])
		.middleware(AuthMiddleware),

	Rpc.make("assistant.stop", {
		payload: Schema.Struct({ organizationId: OrganizationId, threadId: AssistantThreadId }),
		success: AssistantWriteResponse,
		error: writeErrors,
	})
		.annotate(RequiredScopes, ["assistant:write"])
		.middleware(AuthMiddleware),

	/** Rename, or share with the organization (`organization`) and back (`private`). */
	Rpc.make("assistant.update", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			threadId: AssistantThreadId,
			title: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
			visibility: Schema.optional(Assistant.Visibility),
		}),
		success: AssistantWriteResponse,
		error: Schema.Union([AssistantThreadNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["assistant:write"])
		.middleware(AuthMiddleware),

	Rpc.make("assistant.delete", {
		payload: Schema.Struct({ organizationId: OrganizationId, threadId: AssistantThreadId }),
		success: AssistantWriteResponse,
		error: Schema.Union([AssistantThreadNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["assistant:write"])
		.middleware(AuthMiddleware),
) {}
