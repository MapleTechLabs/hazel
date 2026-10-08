import { Effect, Option, Schema } from "effect"
import type { Update } from "foldkit"
import * as Command from "foldkit/command"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Collection from "./aria/collection"

/**
 * Port of `components/ui/tree.tsx` (React Aria Tree, no selection): expansion by chevron and
 * ArrowRight/ArrowLeft, roving focus with ArrowUp/ArrowDown/Home/End over visible rows. The
 * view lives in `tree-view.ts`.
 */

// MODEL

export const Model = Schema.Struct({
	id: Schema.String,
	expandedKeys: Schema.Array(Schema.String),
	maybeFocusedKey: Schema.Option(Schema.String),
	modality: Collection.Modality,
})
export type Model = typeof Model.Type

export const init = (config: {
	readonly id: string
	readonly expandedKeys?: ReadonlyArray<string>
}): Model => ({
	id: config.id,
	expandedKeys: config.expandedKeys ?? [],
	maybeFocusedKey: Option.none(),
	modality: "Unknown",
})

// MESSAGE

export const Message = defineMessageUnion({
	FocusedTree: { targetKey: Schema.String },
	FocusedRow: { key: Schema.String },
	BlurredRow: { key: Schema.String },
	PressedRow: {},
	ClickedChevron: { key: Schema.String },
	NavigatedToRow: {},
	PressedExpandKey: { key: Schema.String },
	PressedCollapseKey: { key: Schema.String },
	ReleasedKey: {},
	CompletedFocusRow: {},
})
export type Message = typeof Message.Type

// COMMAND

export const rowId = (model: Model, key: string) => `${model.id}-${key}`

// NOTE: only moves focus when the tree element itself (or the chevron's row) still needs it.
export const FocusRow = Command.define("FocusRow", {
	args: { rowElementId: Schema.String, onlyFromId: Schema.Option(Schema.String) },
	messages: [Message.CompletedFocusRow],
	execute: ({ rowElementId, onlyFromId }) =>
		Effect.sync(() => {
			const isAllowed = Option.match(onlyFromId, {
				onNone: () => true,
				onSome: (id) => document.activeElement?.id === id,
			})
			if (isAllowed) {
				document.getElementById(rowElementId)?.focus()
			}
			return Message.CompletedFocusRow()
		}),
})

// UPDATE

const withModality = (model: Model, modality: Collection.Modality) =>
	modifyFields(model, { modality: () => modality })

const setExpanded = (model: Model, key: string, isExpanded: boolean) =>
	modifyFields(model, {
		expandedKeys: (keys) =>
			isExpanded
				? [...keys.filter((other) => other !== key), key]
				: keys.filter((other) => other !== key),
	})

export const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		FocusedTree: ({ targetKey }) => ({
			model,
			commands: [
				FocusRow({ rowElementId: rowId(model, targetKey), onlyFromId: Option.some(model.id) }),
			],
		}),
		FocusedRow: ({ key }) => ({
			model: modifyFields(model, { maybeFocusedKey: () => Option.some(key) }),
		}),
		BlurredRow: ({ key }) => ({
			model: modifyFields(model, { maybeFocusedKey: Option.filter((focused) => focused !== key) }),
		}),
		PressedRow: () => ({ model: withModality(model, "Pointer") }),
		ClickedChevron: ({ key }) => ({
			model: setExpanded(withModality(model, "Pointer"), key, !model.expandedKeys.includes(key)),
			commands: [FocusRow({ rowElementId: rowId(model, key), onlyFromId: Option.none() })],
		}),
		NavigatedToRow: () => ({ model: withModality(model, "Keyboard") }),
		PressedExpandKey: ({ key }) => ({ model: setExpanded(withModality(model, "Keyboard"), key, true) }),
		PressedCollapseKey: ({ key }) => ({
			model: setExpanded(withModality(model, "Keyboard"), key, false),
		}),
		ReleasedKey: () => ({ model: withModality(model, "Keyboard") }),
		CompletedFocusRow: () => ({ model }),
	})
