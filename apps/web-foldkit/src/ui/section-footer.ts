import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { sectionFooterStyles } from "~/components/ui/section-footer.styles"

/** Port of `components/ui/section-footer.tsx`. */
export const sectionFooterRoot = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly isCard?: boolean; readonly className?: string },
	children: ReadonlyArray<Html | string>,
): Html =>
	h.div(
		[
			h.Class(
				twMerge(
					sectionFooterStyles.root,
					options.isCard ? sectionFooterStyles.rootCard : sectionFooterStyles.rootPlain,
					options.className,
				),
			),
		],
		[...children],
	)

export const sectionFooterActions = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className?: string },
	children: ReadonlyArray<Html | string>,
): Html => h.div([h.Class(twMerge(sectionFooterStyles.actions, options.className))], [...children])
