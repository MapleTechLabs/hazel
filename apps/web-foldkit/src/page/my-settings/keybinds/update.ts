import { modifyFields } from "foldkit/struct"
import { appKeymap } from "~/lib/keybindings/app-keymap"
import { comboLabel, isTypingSafe, type KeyCombo, parseCombo } from "~/lib/keybindings/key-combo"
import type { Overrides } from "~/lib/keybindings/keymap"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { ActionId, Model, Notice } from "./model"

type Return = PageReturn<Model, Message>

export const init = (): Return => ({
	model: { query: "", recording: null, held: [], notice: null },
})

const stopped = (model: Model, notice: Notice | null): Model =>
	modifyFields(model, { recording: () => null, held: () => [], notice: () => notice })

const save = (model: Model, overrides: Overrides): Return => ({
	model,
	outMessage: PageOutMessage.RequestedKeybindings({ overrides }),
})

const labels = (ids: ReadonlyArray<ActionId>) => ids.map((id) => `“${appKeymap.byId[id].label}”`).join(", ")

/** What a new key took from other actions, and what it may lose to. */
const noticeOf = (
	actionId: ActionId,
	key: KeyCombo,
	displaced: ReadonlyArray<ActionId>,
	shadows: ReadonlyArray<ActionId>,
	shared: Shared,
): Notice | null => {
	const label = comboLabel(key, shared.keyboardPlatform)
	const removed = displaced.length > 0 ? `${label} was removed from ${labels(displaced)}.` : null
	if (shadows.length > 0) {
		const shadowed = `${removed === null ? label : "It"} is also ${labels(shadows)}, so it may not work there.`
		return { actionId, tone: "warning", text: removed === null ? shadowed : `${removed} ${shadowed}` }
	}
	return removed === null ? null : { actionId, tone: "info", text: removed }
}

/** Why a key on its own cannot be bound, in the platform's names for the modifiers. */
const needsModifierNotice = (actionId: ActionId, shared: Shared): Notice => ({
	actionId,
	tone: "warning",
	text:
		shared.keyboardPlatform === "mac"
			? "Hold ⌘ or ⌃ too: on its own, or with ⌥ or ⇧, this key types, so it would fire while you type."
			: "Hold Ctrl too: on its own, or with Alt or Shift, this key types, so it would fire while you type.",
})

const recorded = (model: Model, key: KeyCombo, shared: Shared): Return => {
	const actionId = model.recording
	if (actionId === null) return { model }
	// Keep listening, so the next press can add the modifier.
	if (!isTypingSafe(key))
		return {
			model: modifyFields(model, {
				// The modifiers are still down; the subscription sends no repeat to show them again.
				held: () => [...(parseCombo(key)?.modifiers ?? [])],
				notice: () => needsModifierNotice(actionId, shared),
			}),
		}
	const { overrides, displaced, shadows } = appKeymap.assign(
		shared.keybindingOverrides,
		actionId,
		key,
		shared.keyboardPlatform,
	)
	return save(stopped(model, noticeOf(actionId, key, displaced, shadows, shared)), overrides)
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		ChangedQuery: ({ value }) => ({ model: modifyFields(model, { query: () => value }) }),
		ClearedQuery: () => ({ model: modifyFields(model, { query: () => "" }) }),
		ClickedRecord: ({ actionId }) =>
			appKeymap.byId[actionId].rebindable
				? {
						model: modifyFields(model, {
							// A second click on the recording row stops it.
							recording: () => (model.recording === actionId ? null : actionId),
							held: () => [],
							notice: () => null,
						}),
					}
				: { model },
		ChangedHeldModifiers: ({ modifiers }) =>
			model.recording === null ? { model } : { model: modifyFields(model, { held: () => modifiers }) },
		PressedCombo: ({ combo }) => recorded(model, combo, shared),
		// While recording, the only notice is a refused key's, which means nothing once it stops.
		CancelledRecording: () => ({ model: stopped(model, model.recording === null ? model.notice : null) }),
		ClickedReset: ({ actionId }) => {
			const { overrides, displaced } = appKeymap.reset(
				shared.keybindingOverrides,
				actionId,
				shared.keyboardPlatform,
			)
			const key = appKeymap.byId[actionId].defaultKey
			return save(
				stopped(model, key === null ? null : noticeOf(actionId, key, displaced, [], shared)),
				overrides,
			)
		},
		ClickedUnbind: ({ actionId }) =>
			save(stopped(model, null), appKeymap.unbind(shared.keybindingOverrides, actionId)),
		ClickedResetAll: () => save(stopped(model, null), {}),
	})
