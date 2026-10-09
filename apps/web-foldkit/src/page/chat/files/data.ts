import type { ChannelId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Effect, Queue, Stream } from "effect"
import { attachmentCollection, userCollection } from "~/db/collections"
import { liveQueryStream } from "../../../data/live-query"
import { type AttachmentQueryRow, type Breakpoint, type FileAttachment, toFileAttachment } from "./queries"

/** Data bridge for the Files tab: the exact `useChannelAttachments` query behind `liveQueryStream`. */

export const attachmentsStream = <Message>(
	channelId: ChannelId,
	toMessage: (attachments: ReadonlyArray<FileAttachment>, nowMs: number) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<AttachmentQueryRow, ReadonlyArray<AttachmentQueryRow>>(
		(q) =>
			q
				.from({ attachments: attachmentCollection })
				.leftJoin({ user: userCollection }, ({ attachments, user }) =>
					eq(attachments.uploadedBy, user.id),
				)
				.where(({ attachments }) =>
					and(
						eq(attachments.channelId, channelId),
						eq(attachments.status, "complete"),
						isNull(attachments.deletedAt),
					),
				)
				.orderBy(({ attachments }) => attachments.uploadedAt, "desc"),
		(rows) => rows,
	).pipe(
		// Legacy reads `new Date()` at render; the emit time is the closest pure equivalent.
		Stream.map((rows) => toMessage(rows.map(toFileAttachment), Date.now())),
	)

const queries: ReadonlyArray<readonly [Breakpoint, string]> = [
	["xl", "(min-width: 1280px)"],
	["lg", "(min-width: 1024px)"],
	["sm", "(min-width: 640px)"],
]

const currentBreakpoint = (): Breakpoint =>
	queries.find(([, query]) => matchMedia(query).matches)?.[0] ?? "base"

/** `useBreakpoint("xl" | "lg" | "sm")` as one stream: the current value, then every change. */
export const breakpointStream = <Message>(
	toMessage: (breakpoint: Breakpoint) => Message,
): Stream.Stream<Message> =>
	Stream.callback<Message>((queue) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const lists = queries.map(([, query]) => matchMedia(query))
				const emit = () => Queue.offerUnsafe(queue, toMessage(currentBreakpoint()))
				lists.forEach((list) => list.addEventListener("change", emit))
				emit()
				return () => lists.forEach((list) => list.removeEventListener("change", emit))
			}),
			(release) => Effect.sync(release),
		).pipe(Effect.flatMap(() => Effect.never)),
	)
