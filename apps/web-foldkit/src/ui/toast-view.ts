import type { EntryHandlers } from "@foldkit/ui/toast"
import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { toastStyles } from "~/components/ui/toast.styles"
import { IconClose } from "../icons"
import type { Action, Entry, Kind } from "./toast"
// Pending-button announcements; every root renders the toaster, so they load with it.

/** One toast's card, drawn inside the kit's entry `<div>`: icon, title, description, action, close. */

// sonner's built-in icons, which the app's toasts have always shown.
const iconPaths: Readonly<Record<Exclude<Kind, "loading">, { viewBox: string; d: string }>> = {
	success: {
		viewBox: "0 0 20 20",
		d: "M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z",
	},
	warning: {
		viewBox: "0 0 24 24",
		d: "M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z",
	},
	info: {
		viewBox: "0 0 20 20",
		d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z",
	},
	error: {
		viewBox: "0 0 20 20",
		d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z",
	},
}

const kindIcon = <M>(h: HtmlBuilder<M>, kind: Kind, className: string): Html =>
	kind === "loading"
		? h.svg(
				[
					h.Attribute("viewBox", "0 0 24 24"),
					h.Attribute("fill", "none"),
					h.Attribute("aria-hidden", "true"),
					h.Attribute("class", className),
					h.DataAttribute("slot", "icon"),
				],
				[
					h.circle([
						h.Attribute("cx", "12"),
						h.Attribute("cy", "12"),
						h.Attribute("r", "9"),
						h.Attribute("stroke", "currentColor"),
						h.Attribute("stroke-opacity", "0.25"),
						h.Attribute("stroke-width", "3"),
					]),
					h.path([
						h.Attribute("d", "M21 12a9 9 0 0 0-9-9"),
						h.Attribute("stroke", "currentColor"),
						h.Attribute("stroke-width", "3"),
						h.Attribute("stroke-linecap", "round"),
					]),
				],
			)
		: h.svg(
				[
					h.Attribute("viewBox", iconPaths[kind].viewBox),
					h.Attribute("fill", "currentColor"),
					h.Attribute("aria-hidden", "true"),
					h.Attribute("class", className),
					h.DataAttribute("slot", "icon"),
				],
				[
					h.path([
						h.Attribute("fill-rule", "evenodd"),
						h.Attribute("d", iconPaths[kind].d),
						h.Attribute("clip-rule", "evenodd"),
					]),
				],
			)

/** `onAction` is the Message the action button dispatches; the close button dismisses through the kit. */
export const entryView = <M>(
	h: HtmlBuilder<M>,
	entry: Entry,
	handlers: EntryHandlers,
	onAction: (entryId: string, action: Action) => M,
): Html => {
	const { kind, title, maybeDescription, maybeAction } = entry.payload
	const styles = toastStyles({ kind })
	return h.div(
		[h.Class(styles.card()), h.DataAttribute("kind", kind)],
		[
			kindIcon(h, kind, styles.icon()),
			h.div(
				[h.Class(styles.content())],
				[
					h.div([h.Class(styles.title()), h.DataAttribute("slot", "title")], [title]),
					...Option.match(maybeDescription, {
						onNone: () => [],
						onSome: (description) => [
							h.div(
								[h.Class(styles.description()), h.DataAttribute("slot", "description")],
								[description],
							),
						],
					}),
				],
			),
			...Option.match(maybeAction, {
				onNone: () => [],
				onSome: (action) => [
					h.button(
						[h.Type("button"), h.Class(styles.action()), h.OnClick(onAction(entry.id, action))],
						[action.label],
					),
				],
			}),
			h.button(
				[
					...handlers.dismiss,
					h.Type("button"),
					h.AriaLabel("Dismiss notification"),
					h.Class(styles.close()),
				],
				[IconClose(h, { className: "size-3.5" })],
			),
		],
	)
}
