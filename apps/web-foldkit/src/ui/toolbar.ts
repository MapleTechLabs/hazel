import { Array, Effect, Option, Schema } from "effect"
import type { Update } from "foldkit"
import * as Command from "foldkit/command"
import type { Html } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { defineView } from "foldkit/submodel"
import { twMerge } from "tailwind-merge"
import { toolbarStyles } from "~/components/ui/toolbar.styles"
import * as Collection from "./aria/collection"

/**
 * Port of `components/ui/toolbar.tsx` (React Aria Toolbar): arrow keys move focus between the
 * focusable children without wrapping. RA's "Tab leaves the whole toolbar" is not emulated.
 */

// MODEL

export const Model = Schema.Struct({
	label: Schema.String,
	orientation: Collection.Orientation,
})
export type Model = typeof Model.Type

export const init = (config: {
	readonly label: string
	readonly orientation?: Collection.Orientation
}): Model => ({
	label: config.label,
	orientation: config.orientation ?? "horizontal",
})

// MESSAGE

export const Message = defineMessageUnion({
	PressedNavigationKey: { direction: Schema.Literals(["Next", "Previous"]) },
	CompletedFocusToolbarItem: {},
})
export type Message = typeof Message.Type

// COMMAND

const FOCUSABLE =
	"button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]"

// NOTE: reads document.activeElement when it runs, so queued presses each start from the latest focus.
const FocusToolbarItem = Command.define("FocusToolbarItem", {
	args: { label: Schema.String, direction: Schema.Literals(["Next", "Previous"]) },
	messages: [Message.CompletedFocusToolbarItem],
	execute: ({ label, direction }) =>
		Effect.sync(() => {
			const toolbar = document.querySelector(`[role="toolbar"][aria-label="${CSS.escape(label)}"]`)
			const items = toolbar
				? globalThis.Array.from(toolbar.querySelectorAll<HTMLElement>(FOCUSABLE))
				: []
			const maybeIndex = Array.findFirstIndex(items, (item) => item === document.activeElement)
			const maybeTarget = Option.flatMap(maybeIndex, (index) =>
				Array.get(items, direction === "Next" ? index + 1 : index - 1),
			)
			if (Option.isSome(maybeTarget)) {
				maybeTarget.value.focus()
			}
			return Message.CompletedFocusToolbarItem()
		}),
})

// UPDATE

export const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		PressedNavigationKey: ({ direction }) => ({
			model,
			commands: [FocusToolbarItem({ label: model.label, direction })],
		}),
		CompletedFocusToolbarItem: () => ({ model }),
	})

// VIEW

export type ViewInputs = Readonly<{
	content: ReadonlyArray<Html | string>
	className?: string
}>

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const navigate = (keyboardKey: string) =>
		Option.flatMap(Collection.directionOfKey(model.orientation, keyboardKey), (direction) =>
			direction === "Next" || direction === "Previous"
				? Option.some(Message.PressedNavigationKey({ direction }))
				: Option.none(),
		)
	return h.div(
		[
			h.Class(twMerge(twMerge(toolbarStyles), viewInputs.className)),
			h.Role("toolbar"),
			h.AriaLabel(model.label),
			h.AriaOrientation(model.orientation),
			h.Attribute("data-orientation", model.orientation),
			h.Attribute("data-rac", ""),
			h.OnKeyDownPreventDefault(navigate),
		],
		[...viewInputs.content],
	)
})
