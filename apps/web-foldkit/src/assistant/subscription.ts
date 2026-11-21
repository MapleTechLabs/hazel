import type { Assistant } from "@hazel/domain/models"
import { AssistantThreadId, OrganizationId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Option, Schema, Stream } from "effect"
import { Dom, Subscription } from "foldkit"
import { assistantItemCollection, assistantThreadCollection, userCollection } from "~/db/collections"
import { msOf } from "../customers/queries"
import { liveQueryStream } from "../data/live-query"
import { Message } from "./message"
import { type ItemRow, type Model, QuestionData, type ThreadRow } from "./model"

/** The open panel's live rows (its organization's threads, the open thread's items) and the edge's drag. */

export interface Input {
	readonly model: Model
	readonly organizationId: OrganizationId | null
}

interface ThreadQueryRow {
	readonly thread: Assistant.Thread
	readonly owner?: { readonly firstName: string; readonly lastName: string } | undefined
}

const toThreadRow = ({ thread, owner }: ThreadQueryRow): ThreadRow => ({
	id: thread.id,
	ownerId: thread.ownerId,
	ownerName: owner === undefined ? null : `${owner.firstName} ${owner.lastName}`.trim() || null,
	title: thread.title,
	visibility: thread.visibility,
	status: thread.status,
	errorMessage: thread.errorMessage,
	externalLink: thread.externalLink,
	engineLabel: thread.engineLabel,
	lastActivityAtMs: msOf(thread.lastActivityAt),
})

const decodeQuestion = Schema.decodeUnknownOption(QuestionData)

/** A tool's `data.input` when it is text. */
const inputOf = (data: Assistant.Item["data"]): string | null =>
	typeof data?.input === "string" ? data.input : null

export const toItemRow = (item: Assistant.Item): ItemRow => ({
	id: item.id,
	threadId: item.threadId,
	kind: item.kind,
	status: item.status,
	title: item.title,
	text: item.text,
	input: item.kind === "tool" ? inputOf(item.data) : null,
	question: item.kind === "question" ? Option.getOrNull(decodeQuestion(item.data)) : null,
	createdAtMs: msOf(item.createdAt),
})

const threadsStream = (organizationId: OrganizationId) =>
	liveQueryStream<ThreadQueryRow, Message>(
		(q) =>
			q
				.from({ thread: assistantThreadCollection })
				.leftJoin({ owner: userCollection }, ({ thread, owner }) => eq(owner.id, thread.ownerId))
				.where(({ thread }) =>
					and(eq(thread.organizationId, organizationId), isNull(thread.deletedAt)),
				),
		(rows) => Message.UpdatedThreads({ organizationId, threads: rows.map(toThreadRow) }),
	)

const itemsStream = (threadId: AssistantThreadId) =>
	liveQueryStream<{ readonly item: Assistant.Item }, Message>(
		(q) =>
			q
				.from({ item: assistantItemCollection })
				.where(({ item }) => and(eq(item.threadId, threadId), isNull(item.deletedAt))),
		(rows) => Message.UpdatedItems({ threadId, items: rows.map((row) => toItemRow(row.item)) }),
	)

export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	assistantThreads: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ model, organizationId }) => ({
				organizationId: model.isOpen ? organizationId : null,
			}),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null ? Stream.empty : threadsStream(organizationId),
		},
	),
	assistantItems: entry(
		{ threadId: Schema.NullOr(AssistantThreadId) },
		{
			modelToDependencies: ({ model }) => ({ threadId: model.isOpen ? model.threadId : null }),
			dependenciesToStream: ({ threadId }) =>
				threadId === null ? Stream.empty : itemsStream(threadId),
		},
	),
	// The edge's drag: window listeners, so the pointer may leave the thin handle.
	assistantPanelDrag: entry(
		{ isDragging: Schema.Boolean },
		{
			modelToDependencies: ({ model }) => ({ isDragging: model.drag !== null }),
			dependenciesToStream: ({ isDragging }) =>
				isDragging
					? Stream.merge(
							Dom.streamFromEvent({
								target: window,
								type: "pointermove",
								mapEvent: (event) => Message.MovedEdge({ clientX: event.clientX }),
							}),
							Stream.merge(
								Dom.streamFromEvent({
									target: window,
									type: "pointerup",
									mapEvent: () => Message.ReleasedEdge(),
								}),
								Dom.streamFromEvent({
									target: window,
									type: "pointercancel",
									mapEvent: () => Message.ReleasedEdge(),
								}),
							),
						)
					: Stream.empty,
		},
	),
}))
