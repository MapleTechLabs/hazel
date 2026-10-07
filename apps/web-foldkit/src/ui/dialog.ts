import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	dialogBase,
	dialogBodyBase,
	dialogCloseIconBase,
	dialogDescriptionBase,
	dialogFooterBase,
	dialogHeaderBase,
	dialogTitleBase,
} from "~/components/ui/dialog.styles"
import { IconClose } from "../icons"
import { button } from "./button"

/**
 * Port of `components/ui/dialog.tsx`: the parts Modal, Sheet and Popover compose. The overlay that
 * hosts a dialog owns its behavior; these are pure views. Header and footer heights
 * (`--dialog-header-height`, `--dialog-footer-height`) are measured by that host's Mount.
 */

type Children = ReadonlyArray<Html | string>
type Attributes<Message> = ReadonlyArray<Attribute<Message> | ChildAttribute>

/** `Dialog`: the element with role dialog (or alertdialog) that holds the content. */
export const dialog = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{ id: string; role: string; labelledBy?: string; className?: string }>,
	children: Children,
): Html =>
	h.section(
		[
			...(options.labelledBy ? [h.Attribute("aria-labelledby", options.labelledBy)] : []),
			h.Class(twMerge(dialogBase, options.className)),
			h.Attribute("data-rac", ""),
			h.Attribute("data-slot", "dialog"),
			h.Id(options.id),
			h.Role(options.role),
			h.Attribute("tabindex", "-1"),
		],
		children,
	)

/** `DialogTitle` (React Aria Heading): level 2 with an id inside a Dialog, level 3 without one in a Popover. */
export const dialogTitle = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{ id?: string; className?: string }>,
	text: string,
): Html => {
	const attributes = [
		h.Class(twMerge(dialogTitleBase, options.className)),
		...(options.id ? [h.Id(options.id)] : []),
		h.Attribute("slot", "title"),
	]
	return options.id ? h.h2(attributes, [text]) : h.h3(attributes, [text])
}

/** `DialogDescription`. */
export const dialogDescription = <Message>(h: HtmlBuilder<Message>, text: string, className?: string): Html =>
	h.p([h.Attribute("data-slot", "description"), h.Class(twMerge(dialogDescriptionBase, className))], [text])

/** `DialogHeader`; `title` and `description` render the title and description like the legacy props. */
export const dialogHeader = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{
		className?: string
		title?: Readonly<{ id?: string; text: string }>
		description?: string
	}>,
	children: Children = [],
): Html =>
	h.div(
		[h.Attribute("data-slot", "dialog-header"), h.Class(twMerge(dialogHeaderBase, options.className))],
		[
			...(options.title ? [dialogTitle(h, { id: options.title.id }, options.title.text)] : []),
			...(options.description ? [dialogDescription(h, options.description)] : []),
			...children,
		],
	)

/** `DialogBody`. */
export const dialogBody = <Message>(h: HtmlBuilder<Message>, children: Children, className?: string): Html =>
	h.div([h.Attribute("data-slot", "dialog-body"), h.Class(twMerge(...dialogBodyBase, className))], children)

/** `DialogFooter`. */
export const dialogFooter = <Message>(
	h: HtmlBuilder<Message>,
	children: Children,
	className?: string,
): Html =>
	h.div(
		[h.Attribute("data-slot", "dialog-footer"), h.Class(twMerge(dialogFooterBase, className))],
		children,
	)

/** `DialogClose`: a plain Button in the close slot; `attributes` come from the hosting overlay. */
export const dialogClose = <Message>(
	h: HtmlBuilder<Message>,
	attributes: Attributes<Message>,
	children: Children,
	intent: Parameters<typeof button>[1]["intent"] = "plain",
): Html => button(h, { intent, attributes: [...attributes, h.Attribute("slot", "close")] }, [...children])

/** `DialogCloseIcon`, rendered by the overlay when it is dismissable. */
export const dialogCloseIcon = <Message>(
	h: HtmlBuilder<Message>,
	attributes: Attributes<Message>,
	className?: string,
): Html =>
	h.button(
		[
			...attributes,
			h.Attribute("aria-label", "Close"),
			h.Class(twMerge(twMerge(dialogCloseIconBase), className)),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Attribute("slot", "close"),
			h.Attribute("tabindex", "0"),
			h.Attribute("type", "button"),
		],
		[IconClose(h, { className: "size-4" })],
	)
