import type { CustomerAccountId } from "@hazel/schema"
import { Effect } from "effect"
import type { NoteDraft } from "./message"
import { EMPTY_NOTE_DRAFTS, type NoteDrafts } from "./model"

/**
 * Unsent note text per customer, outside the page instance: Prev/Next, the breadcrumb and the sidebar
 * build a new instance, and a save that fails after the user left puts its text back here. In memory
 * only: a reload drops it.
 */
const store = new Map<CustomerAccountId, NoteDrafts>()

export const readNoteDrafts = (accountId: CustomerAccountId): Effect.Effect<NoteDrafts> =>
	Effect.sync(() => store.get(accountId) ?? EMPTY_NOTE_DRAFTS)

export const writeNoteDrafts = (accountId: CustomerAccountId, drafts: NoteDrafts): Effect.Effect<void> =>
	Effect.sync(() => {
		if (drafts.composer.body === "" && drafts.editingNote === null) store.delete(accountId)
		else store.set(accountId, drafts)
	})

/** A failed save's text goes back where it was typed, unless something else was typed there since. */
export const restoreNoteDraft = (accountId: CustomerAccountId, draft: NoteDraft): Effect.Effect<void> =>
	Effect.flatMap(readNoteDrafts(accountId), (drafts) => {
		const { noteId } = draft
		if (noteId === null)
			return drafts.composer.body === ""
				? writeNoteDrafts(accountId, {
						...drafts,
						composer: { ...drafts.composer, body: draft.body },
					})
				: Effect.void
		return drafts.editingNote === null
			? writeNoteDrafts(accountId, { ...drafts, editingNote: { noteId, body: draft.body } })
			: Effect.void
	})
