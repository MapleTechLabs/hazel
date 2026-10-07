import type { Update } from "foldkit"
import { CloseAutocomplete, InsertMention, Message, type Model, type PresenceStatus, SyncAutocompleteOptions } from "./composer"

/** One row of the mention popover (legacy `AutocompleteOption<MentionData>`). */
export interface MentionOption {
	readonly id: string
	readonly label: string
	readonly description: string | null
	readonly type: "user" | "channel" | "here"
	readonly displayName: string
	readonly avatarUrl: string | null
	readonly status: PresenceStatus | null
}

/** Legacy `useMentionOptions`: @channel and @here first, then channel members, filtered by search. */
export const mentionOptions = (model: Model): ReadonlyArray<MentionOption> => {
	if (model.autocomplete?.trigger !== "mention") return []
	const search = model.autocomplete.search.toLowerCase()
	const special: Array<MentionOption> = [
		{ id: "channel", label: "@channel", description: "Notify all members in this channel" },
		{ id: "here", label: "@here", description: "Notify all online members" },
	]
		.filter(({ id }) => id.includes(search))
		.map(({ id, label, description }) => ({
			id,
			label,
			description,
			type: id === "channel" ? "channel" : "here",
			displayName: id,
			avatarUrl: null,
			status: null,
		}))
	// Mentionable bots come next in legacy; the bot collections are not bridged yet (Phase 4).
	const statusOf = new Map(model.presence.map((row) => [row.userId, row.status]))
	const members = model.members.flatMap((member): Array<MentionOption> => {
		const displayName = `${member.firstName} ${member.lastName}`
		if (!displayName.toLowerCase().includes(search)) return []
		return [
			{
				id: member.userId,
				label: displayName,
				description: null,
				type: "user",
				displayName,
				avatarUrl: member.avatarUrl,
				status: statusOf.get(member.userId) ?? "offline",
			},
		]
	})
	return [...special, ...members]
}

/** Legacy `useSlateAutocomplete` clamps the index to the current list. */
export const clampedActiveIndex = (model: Model) => {
	const count = mentionOptions(model).length
	return count > 0 ? Math.min(model.activeIndex, count - 1) : 0
}

type Return = Update.Return<Model, Message>

const optionCountOf = (model: Model) =>
	model.autocomplete === null ? 0 : model.autocomplete.trigger === "mention" ? mentionOptions(model).length : 0

/** Keep the editor's key capture in step with what the popover shows. */
const withOptionSync = (previous: Model, model: Model): Return =>
	optionCountOf(previous) === optionCountOf(model)
		? { model }
		: { model, commands: [SyncAutocompleteOptions({ editorId: model.editorId, optionCount: optionCountOf(model) })] }

const select = (model: Model, index: number): Return => {
	const option = mentionOptions(model)[index]
	if (!option) return { model }
	return {
		model: { ...model, activeIndex: 0 },
		commands: [InsertMention({ editorId: model.editorId, userId: option.id, displayName: option.displayName })],
	}
}

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		UpdatedDraft: ({ markdown, isEmpty }) => ({ model: { ...model, markdown, isEmpty } }),
		ChangedAutocomplete: ({ autocomplete }) =>
			withOptionSync(model, { ...model, autocomplete, activeIndex: autocomplete === null ? 0 : model.activeIndex }),
		PressedAutocompleteKey: ({ key }) => {
			const count = mentionOptions(model).length
			const index = clampedActiveIndex(model)
			switch (key) {
				case "ArrowDown":
					return { model: { ...model, activeIndex: index >= count - 1 ? 0 : index + 1 } }
				case "ArrowUp":
					return { model: { ...model, activeIndex: index <= 0 ? count - 1 : index - 1 } }
				case "Enter":
				case "Tab":
					return select(model, index)
				case "Escape":
					return { model, commands: [CloseAutocomplete({ editorId: model.editorId })] }
			}
		},
		HoveredAutocompleteOption: ({ index }) => ({ model: { ...model, activeIndex: index } }),
		ClickedAutocompleteOption: ({ index }) => select(model, index),
		UpdatedMentionMembers: ({ members }) => withOptionSync(model, { ...model, members }),
		UpdatedPresence: ({ presence }) => ({ model: { ...model, presence } }),
		// Phase 4: send, edit-last-message and cancel-edit.
		SubmittedDraft: () => ({ model }),
		PressedEscape: () => ({ model }),
		PressedArrowUpInEmpty: () => ({ model }),
		CompletedInsertMention: () => ({ model }),
		CompletedSyncAutocompleteOptions: () => ({ model }),
		CompletedCloseAutocomplete: () => ({ model }),
		CompletedKeepEditorFocus: () => ({ model }),
	})
