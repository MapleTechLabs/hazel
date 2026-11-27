// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A settings page's column and its cards (today's `pageLayout`, `card`, `cardHeader`, `cardBody`
 * and `pageHeader` at `title` size): a header band over a hairline, then the body.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { IconName } from "@hazel/ui/vocabulary/options"

export interface CardHeader<Msg> {
	readonly title: string
	readonly subtitle: string
	/** The glyph before the title. */
	readonly icon?: IconName
	/** A count beside the title (`6 members`). */
	readonly badge?: string
	/** The glyph sits on the title's line at section size, the subtitle under both (the export card). */
	readonly inline?: boolean
	/** At the header's end (an Invite button). */
	readonly action?: Hazel.NoTextInput<Msg>
}

/** The page's cards, 24px apart; the frame gives the column its gutter (`root/native-pages.ts`). */
export const settingsColumn = <Msg>(
	h: Hazel.H<Msg>,
	key: string,
	...cards: ReadonlyArray<Hazel.NoTextInput<Msg>>
) =>
	h.stack
		.key(key)
		.density("relaxed")
		.children(...cards)

const inlineHeader = <Msg>(h: Hazel.H<Msg>, options: CardHeader<Msg>) =>
	h.stack
		.key("card:header")
		.inset("page")
		.density("tight")
		.children(
			h.stack
				.axis("horizontal")
				.align("center")
				.density("compact")
				.children(
					options.icon === undefined ? null : h.icon.name(options.icon),
					h.heading.children(options.title),
				),
			h.text.role("label").tone("muted").children(options.subtitle),
		)

const header = <Msg>(h: Hazel.H<Msg>, options: CardHeader<Msg>) =>
	options.inline === true
		? inlineHeader(h, options)
		: h.stack
				.key("card:header")
				.inset("page")
				.axis("horizontal")
				.align("start")
				// Today's actions drop under the title when the row is narrow (`flex-wrap`, the title's `basis-72`).
				// HAZEL-GAP(p4-wrap-justify): wrapped, today's action starts its line; the spacer ends it here.
				// HAZEL-GAP(p4-icon-tone): today's glyph is muted `size-5` (the danger zone's in danger ink).
				.wrap()
				.density("cozy")
				.children(
					h.stack
						.axis("horizontal")
						.align("start")
						.density("cozy")
						.children(
							options.icon === undefined ? null : h.icon.name(options.icon),
							h.stack.density("tight").children(
								h.stack
									.axis("horizontal")
									.align("center")
									.density("compact")
									.children(
										h.heading.size("large").children(options.title),
										options.badge === undefined
											? null
											: h.badge.label(options.badge).tone("neutral"),
									),
								h.text.role("label").tone("muted").children(options.subtitle),
							),
						),
					options.action === undefined ? null : h.spacer,
					options.action,
				)

/**
 * A card: the header band, a hairline, then `body` edge to edge (a table) or padded (`cardBody`).
 * `danger` is the danger zone.
 */
// HAZEL-GAP(p4-settings-card): today's header and body pad `px-4 md:px-6` (`md:p-6` for the body), and
// the danger zone tints its header (`bg-danger/5`, `border-danger/20`); `frame` `flush` has neither.
export const settingsCard = <Msg>(
	h: Hazel.H<Msg>,
	key: string,
	options: CardHeader<Msg>,
	...body: ReadonlyArray<Hazel.NoTextInput<Msg>>
) =>
	h.frame
		.key(key)
		.surface("flush")
		.children(header(h, options), h.divider.key("card:rule"), ...body)

/** A card's padded body (`cardBody`), its children 24px apart. */
export const cardBody = <Msg>(h: Hazel.H<Msg>, ...children: ReadonlyArray<Hazel.NoTextInput<Msg>>) =>
	h.stack
		.key("card:body")
		.inset("page")
		.density("relaxed")
		.children(...children)
