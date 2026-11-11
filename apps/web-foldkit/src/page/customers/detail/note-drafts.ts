import type { CustomerAccountId } from "@hazel/schema"
import { Effect, PubSub, Stream } from "effect"
import type { Message, NoteDraft } from "./message"
import { EMPTY_NOTE_DRAFTS, type NoteDrafts } from "./model"

/**
 * Unsent note text per customer, outside the page instance: Prev/Next, the breadcrumb and the sidebar
 * build a new instance, and a save that fails after the user left puts its text back here. In memory
 * only: a reload drops it, and so does a new sign-in.
 */
const store = new Map<CustomerAccountId, NoteDrafts>()

/** Each restore, for the customer's open instance: else its next write-back would drop the text. */
const restores = Effect.runSync(
	PubSub.unbounded<{ readonly accountId: CustomerAccountId; readonly draft: NoteDraft }>(),
)

export const readNoteDrafts = (accountId: CustomerAccountId): Effect.Effect<NoteDrafts> =>
	Effect.sync(() => store.get(accountId) ?? EMPTY_NOTE_DRAFTS)

export const writeNoteDrafts = (accountId: CustomerAccountId, drafts: NoteDrafts): Effect.Effect<void> =>
	Effect.sync(() => {
		if (drafts.composer.body === "" && drafts.editingNote === null) store.delete(accountId)
		else store.set(accountId, drafts)
	})

export const clearNoteDrafts: Effect.Effect<void> = Effect.sync(() => store.clear())

/** The drafts restored for `accountId` from now on. */
export const restoredNoteDrafts = (accountId: CustomerAccountId): Stream.Stream<NoteDraft> =>
	Stream.fromPubSub(restores).pipe(
		Stream.filter((restore) => restore.accountId === accountId),
		Stream.map((restore) => restore.draft),
	)

/** The text a failed note action hands back: none for an edit whose note was deleted. */
export const draftToRestore = ({
	action,
	reason,
	draft,
}: Extract<Message, { readonly _tag: "FailedNoteAction" }>): NoteDraft | null =>
	action === "update" && reason === "NotFound" ? null : draft

/** A failed save's text goes back where it was typed, unless something else was typed there since. */
export const restoreNoteDraft = (accountId: CustomerAccountId, draft: NoteDraft): Effect.Effect<void> =>
	Effect.flatMap(readNoteDrafts(accountId), (drafts) => {
		const { noteId } = draft
		const restored =
			noteId === null
				? drafts.composer.body === ""
					? { ...drafts, composer: { ...drafts.composer, body: draft.body } }
					: null
				: drafts.editingNote === null
					? { ...drafts, editingNote: { noteId, body: draft.body } }
					: null
		return restored === null
			? Effect.void
			: writeNoteDrafts(accountId, restored).pipe(
					Effect.andThen(PubSub.publish(restores, { accountId, draft })),
					Effect.asVoid,
				)
	})
