import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { cardStyles } from "~/components/ui/card.styles"
import { heading } from "./heading"

/** Port of `components/ui/card.tsx`. */
export const card = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly variant?: "default" | "danger"; readonly className?: string },
	children: Html[],
): Html =>
	h.div(
		[
			h.Class(
				twMerge(
					cardStyles.card,
					options.variant === "danger" ? cardStyles.cardDanger : cardStyles.cardDefault,
					options.className,
				),
			),
		],
		children,
	)

export const cardHeader = <Message>(h: HtmlBuilder<Message>, children: Html[], className?: string): Html =>
	h.div([h.Class(twMerge(cardStyles.cardHeader, className))], children)

export const cardBody = <Message>(h: HtmlBuilder<Message>, children: Html[], className?: string): Html =>
	h.div([h.Class(twMerge(cardStyles.cardBody, className))], children)

export const cardTitle = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className?: string },
	children: Array<Html | string>,
): Html => heading(h, { variant: "section", className: options.className }, children)

export const cardDescription = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className?: string },
	children: Array<Html | string>,
): Html => h.p([h.Class(twMerge(cardStyles.cardDescription, options.className))], children)

/**
 * The card's class bundle, for a card that must be another element or carry its own layout (a chart
 * frame, a `<details>`). Prefer `card` or `panel`.
 */
export const cardClassName = (className?: string) =>
	twMerge(cardStyles.card, cardStyles.cardDefault, className)

/**
 * A card that is one padded stack: a dashboard panel, a settings group, a chart. Lead it with a
 * `panelHeader`; for a header bar with a hairline under it, use `card` + `cardHeader` instead.
 */
export const panel = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className?: string },
	children: ReadonlyArray<Html>,
): Html =>
	h.section(
		[h.Class(cardClassName(twMerge("flex min-w-0 flex-col gap-4 p-4 sm:p-5", options.className)))],
		[...children],
	)

/** `Title 12` over a description, with an aside (a link, a toggle) at the right: a panel's head. */
export const panelHeader = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{
		title: Html | string
		count?: number | string
		description?: Html | string
		aside?: Html
		className?: string
	}>,
): Html =>
	h.header(
		[h.Class(twMerge("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", options.className))],
		[
			// A basis: the title shrinks before the aside wraps under it, and wraps only when narrow.
			h.div(
				[h.Class("flex min-w-0 flex-1 basis-40 flex-col")],
				[
					typeof options.title === "string"
						? heading(h, { variant: "section", className: "flex items-baseline gap-2" }, [
								options.title,
								...(options.count === undefined
									? []
									: [
											h.span(
												[h.Class("font-normal text-muted-fg text-sm tabular-nums")],
												[String(options.count)],
											),
										]),
							])
						: options.title,
					...(options.description === undefined
						? []
						: [h.p([h.Class(cardStyles.cardDescription)], [options.description])]),
				],
			),
			...(options.aside ? [options.aside] : []),
		],
	)
