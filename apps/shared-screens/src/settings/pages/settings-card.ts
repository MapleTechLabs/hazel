// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the Groups, Custom emojis and Connect invites pages share: today's settings card
 * (`ui/card.ts` with `cardHeader` and `pageHeader` `size: "title"`) over an edge-to-edge body.
 */
import type { Hazel, IconName } from "@hazel/ui/vocabulary/index"

type Child<Msg> = Hazel.NoTextInput<Msg>

export interface CardHeader<Msg> {
	readonly icon?: IconName
	readonly title: string
	readonly subtitle: string
	readonly badge?: string | undefined
	readonly actions?: ReadonlyArray<Child<Msg>>
}

/** The page's column: its cards 24px apart, under the section layout's scroll column. */
// HAZEL-GAP(p4-settings-page-column): today's column is `gap-6 px-4 lg:px-8` with no vertical inset; `inset` `page` pads every side by 16px.
export const settingsColumn = <Msg>(h: Hazel.H<Msg>, key: string, ...children: ReadonlyArray<Child<Msg>>) =>
	h.stack
		.key(key)
		.density("relaxed")
		.inset("page")
		.children(...children)

/** The card's header: icon, title with a count badge, subtitle, and the actions at the end. */
// HAZEL-GAP(p4-settings-card-header): today's header is a `px-4 py-4 md:px-6` bar; `inset` `page` is 16px on every width.
export const cardHeader = <Msg>(h: Hazel.H<Msg>, header: CardHeader<Msg>) =>
	h.stack
		.key("header")
		.inset("page")
		.children(
			// Wraps as today's: on a narrow card the actions drop under the title.
			h.stack
				.axis("horizontal")
				.align("start")
				.density("cozy")
				.wrap()
				.children(
					// The mark stays by the title when the title block wraps.
					h.stack
						.key("title")
						.axis("horizontal")
						.align("start")
						.density("cozy")
						.children(
							header.icon === undefined ? null : h.icon.name(header.icon),
							h.stack.density("tight").children(
								h.stack
									.axis("horizontal")
									.align("center")
									.density("compact")
									.wrap()
									.children(
										h.heading.level("2").size("large").children(header.title),
										header.badge === undefined ? null : h.badge.label(header.badge),
									),
								h.text.tone("muted").children(header.subtitle),
							),
						),
					h.spacer,
					header.actions === undefined || header.actions.length === 0
						? null
						: h.stack
								.axis("horizontal")
								.align("center")
								.density("compact")
								.children(...header.actions),
				),
		)

/** The settings card with no padding, so its hairlines and table run edge to edge. */
export const settingsCard = <Msg>(h: Hazel.H<Msg>, key: string, ...children: ReadonlyArray<Child<Msg>>) =>
	h.frame
		.key(key)
		.surface("flush")
		.children(...children)

/** A padded band inside the card (the create form, the upload zone). */
export const cardBand = <Msg>(h: Hazel.H<Msg>, key: string, ...children: ReadonlyArray<Child<Msg>>) =>
	h.stack
		.key(key)
		.inset("page")
		.children(...children)
