// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Keyboard shortcuts (the deleted Foldkit `overlay/modal/keyboard-shortcuts.ts`, Discord's Mod+/
 * "Keyboard Combos"): every action on the user's keys, by category, in the platform's notation.
 */
import { UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Navigate } from "../app/requests"
import { type AppActionId, appKeymap, KEYMAP_CATEGORIES } from "../lib/keybindings/app-keymap"
import { comboLabel, Platform } from "../lib/keybindings/key-combo"
import { Overrides } from "../lib/keybindings/keymap"
import { ModalEvents } from "./feedback"

export const KeyboardShortcutsProps = Schema.Struct({
	/** The user's key overrides; the modal resolves them for `platform`. */
	overrides: Overrides,
	platform: Platform,
	orgSlug: Schema.NullOr(Schema.String),
})
export type KeyboardShortcutsProps = typeof KeyboardShortcutsProps.Type

export const KeyboardShortcutsMessage = UiSchema.TaggedEnum({
	PressedCustomize: {},
	PressedClose: {},
	DismissedDialog: {},
})
export type KeyboardShortcutsMessage = typeof KeyboardShortcutsMessage.Type

/** Aliases of the unread-channel steps until there is mention data: not listed twice. */
const UNLISTED: ReadonlySet<AppActionId> = new Set(["mention.previous", "mention.next"])

const close = ModalEvents.RequestedClose()

export const KeyboardShortcutsModal = Hazel.component({
	name: "KeyboardShortcutsModal",
	props: KeyboardShortcutsProps,
	model: Schema.Struct({}),
	message: KeyboardShortcutsMessage,
	events: ModalEvents,
}).make({
	init: () => ({}),
	update: {
		PressedCustomize: ($) =>
			$.props.orgSlug === null
				? $.model
				: $.run(
						Navigate.make({ href: `/${$.props.orgSlug}/my-settings/keybinds`, replace: false }),
					).emit(close),
		PressedClose: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
	},
	view: (h) => {
		const { overrides, platform, orgSlug } = h.props
		const keys = appKeymap.resolve(overrides, platform)
		const row = (id: AppActionId) => {
			const combos = appKeymap.keysOf(keys, id)
			return h.item
				.key(id)
				.title(appKeymap.byId[id].label)
				.trailing(
					...(combos.length === 0
						? [h.text.role("caption").tone("muted").children("Not set")]
						: combos.map((combo) => h.text.role("kbd").children(comboLabel(combo, platform)))),
				)
		}
		return (
			h.dialog
				.open(true)
				// HAZEL-GAP(po2-dialog-2xl): today's panel is the kit's `2xl` (42rem); `large` is 32rem.
				.size("large")
				.title("Keyboard shortcuts")
				.on("dismiss", KeyboardShortcutsMessage.DismissedDialog())
				.children(
					// HAZEL-GAP(po2-shortcut-rows): today each category is a divided list of 14px rows, two columns from `sm`.
					h.grid.columns("2").children(
						...KEYMAP_CATEGORIES.map((category) =>
							h.stack
								.key(category)
								.density("tight")
								.children(
									h.text.role("overline").children(category),
									...appKeymap.actions
										.filter(
											(action) =>
												action.category === category && !UNLISTED.has(action.id),
										)
										.map((action) => row(action.id)),
								),
						),
					),
				)
				.secondaryActions(
					orgSlug === null
						? null
						: h.button
								.label("Customize keybinds")
								.variant("ghost")
								.on("press", KeyboardShortcutsMessage.PressedCustomize()),
				)
				.actions(
					h.button
						.label("Close")
						.variant("outline")
						.on("press", KeyboardShortcutsMessage.PressedClose()),
				)
		)
	},
})
