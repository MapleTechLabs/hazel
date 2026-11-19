import type { Attribute, HtmlBuilder } from "foldkit/html"

/**
 * Cross-platform UI (spike, `docs/cross-platform-ui.md`): a kit element says what it is, so a native
 * renderer can draw the platform's own component for it from the same view. The element keeps its
 * markup and classes: the browser draws it as before and ignores these attributes. A native
 * renderer reads only `data-ui` and its props; what carries no `data-ui` is unconverted to it.
 *
 * Presses come back as DOM events on this markup: an `item` is the `click` of its link (or of
 * itself), an `action` its own `click`.
 */
export type SemanticNode =
	/** A screen of its own: its title, and what is in it. */
	| Readonly<{ kind: "screen"; title: string }>
	/** A titled group of rows. */
	| Readonly<{ kind: "section"; title: string }>
	/** A message composer: a native one types into it and sends with its own send. */
	| Readonly<{ kind: "composer"; placeholder: string; hasContent: boolean }>
	/** A button with no text of its own (a section's "+"): an SF Symbol and what it does. */
	| Readonly<{ kind: "action"; label: string; symbol: string }>
	/** A row: what it is called, what marks it, whether it is the one shown, how many unread. */
	| Readonly<{
			kind: "item"
			title: string
			/** An SF Symbol; the web draws its own icon. */
			symbol?: string
			/** The channel's own emoji, in place of the symbol. */
			emoji?: string
			/** A person: their picture, or their initials. */
			avatar?: Readonly<{ url: string | null; initials: string }>
			badge?: number
			isSelected?: boolean
			/** Unread: the title reads stronger. */
			isEmphasized?: boolean
			/** Nested under the row before it (a channel's thread). */
			level?: number
			/** A second line (an account's email). */
			subtitle?: string
			/** An SF Symbol at the row's end (a switcher's chevrons). */
			trailingSymbol?: string
			/** Stays put above or below the screen's scrolling content (a header, a footer). */
			pin?: "top" | "bottom"
	  }>

/** The attributes that mark an element as `node`. Props drop `undefined` (JSON does). */
export const semantic = <Message>(
	h: HtmlBuilder<Message>,
	node: SemanticNode,
): ReadonlyArray<Attribute<Message>> => {
	const { kind, ...props } = node
	return [h.Attribute("data-ui", kind), h.Attribute("data-ui-props", JSON.stringify(props))]
}

/** A person's initials, as an avatar without a picture shows them. */
export const initialsOf = (name: string): string =>
	name
		.split(/\s+/)
		.filter((part) => part.length > 0)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("")
