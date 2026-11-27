// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the Overview and Support report pages draw alike (today's `ui/page-header.ts` and the card's
 * `panel` and `panelHeader`), over hazel stacks, headings and frames.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { Session } from "../../app/session"

type Child<Msg> = Hazel.NoTextInput<Msg>

/** An in-app href under the session's org: `/acme/customers/settings/sla`. */
export const customersHref = (session: Session, path: string) => `/${session.orgSlug ?? ""}/customers${path}`

/**
 * The page's title row: the display title over a muted subtitle, the actions at the end; on a phone
 * (`stacked`) the actions sit under the title, as today's row wraps them.
 */
// HAZEL-GAP(p4-screen-page-column): today's `pageHeader` (a `basis-72` title that wraps its subtitle beside the actions).
export const pageHeader = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		title: string
		subtitle: string
		actions: ReadonlyArray<Child<Msg>>
		stacked: boolean
		/** The actions' gap: the overview's `gap-4`, else the kit's `gap-2`. */
		actionsDensity?: "compact" | "regular"
	}>,
) => {
	const title = h.stack
		.density("tight")
		.children(
			h.heading.level("1").children(options.title),
			h.text.role("label").tone("muted").children(options.subtitle),
		)
	const actions =
		options.actions.length === 0
			? null
			: h.stack
					.axis("horizontal")
					.density(options.actionsDensity ?? "compact")
					.align("center")
					.wrap()
					.children(...options.actions)
	if (options.stacked) return h.stack.key("header").density("cozy").align("start").children(title, actions)
	return h.stack
		.key("header")
		.axis("horizontal")
		.density("regular")
		.align("start")
		.children(title, actions === null ? null : h.spacer, actions)
}

/** A card that is one padded stack: a dashboard panel, a chart (today's `panel`). */
export const panel = <Msg>(h: Hazel.H<Msg>, key: string, children: ReadonlyArray<Child<Msg>>) =>
	h.frame
		.key(key)
		.surface("tile")
		.children(...children)

/** `Title` over a description, with an aside (a link, a toggle) at the end: a panel's head. */
export const panelHeader = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		title: string
		count?: number
		description?: string
		/** A chart card's description is muted (`descriptionClass`); a panel's `fg-2`. */
		descriptionTone?: "subtle" | "muted"
		aside?: Child<Msg>
	}>,
) =>
	h.stack
		.axis("horizontal")
		.align("start")
		.wrap()
		.children(
			h.stack.density("none").children(
				options.count === undefined
					? h.heading.children(options.title)
					: h.stack
							.axis("horizontal")
							.density("compact")
							.align("center")
							.children(
								h.heading.children(options.title),
								h.text.role("label").tone("muted").numeric().children(String(options.count)),
							),
				options.description === undefined
					? null
					: h.text
							.role("label")
							.tone(options.descriptionTone ?? "subtle")
							.children(options.description),
			),
			options.aside === undefined ? null : h.spacer,
			// A row keeps a control at its own width (a choice group fills its line alone).
			options.aside === undefined ? null : h.stack.axis("horizontal").children(options.aside),
		)
