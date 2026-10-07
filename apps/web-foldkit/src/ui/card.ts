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

export const cardHeader = <Message>(h: HtmlBuilder<Message>, children: Html[], className?: string): Html =>
	h.div([h.Class(twMerge(cardStyles.cardHeader, className))], children)

export const cardHeaderGroup = <Message>(h: HtmlBuilder<Message>, children: Html[]): Html =>
	h.div([h.Class(twMerge(cardStyles.cardHeaderGroup))], children)

export const cardBody = <Message>(h: HtmlBuilder<Message>, children: Html[], className?: string): Html =>
	h.div([h.Class(twMerge(cardStyles.cardBody, className))], children)
