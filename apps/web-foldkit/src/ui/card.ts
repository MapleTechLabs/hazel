import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { cardStyles } from "~/components/ui/card.styles"

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

export const cardHeader = <Message>(h: HtmlBuilder<Message>, children: Html[]): Html =>
	h.div([h.Class(twMerge(cardStyles.cardHeader))], children)

export const cardHeaderGroup = <Message>(h: HtmlBuilder<Message>, children: Html[]): Html =>
	h.div([h.Class(twMerge(cardStyles.cardHeaderGroup))], children)

export const cardTitle = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className?: string },
	children: Array<Html | string>,
): Html => h.h2([h.Class(twMerge(cardStyles.cardTitle, options.className))], children)

export const cardDescription = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className?: string },
	children: Array<Html | string>,
): Html => h.p([h.Class(twMerge(cardStyles.cardDescription, options.className))], children)
