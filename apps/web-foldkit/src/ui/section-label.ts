import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { sectionLabelStyles } from "~/components/ui/section-label.styles"

/** Port of `components/ui/section-label.tsx`. */
export const sectionLabelRoot = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly title: Html | string
		readonly size?: "sm" | "md"
		readonly isRequired?: boolean
		readonly description?: Html | string
		readonly className?: string
	},
	children: ReadonlyArray<Html | string> = [],
): Html => {
	const size = sectionLabelStyles.sizes[options.size ?? "sm"]
	return h.div(options.className === undefined ? [] : [h.Class(options.className)], [
		h.h3(
			[h.Class(twMerge(sectionLabelStyles.heading, size.heading))],
			[
				options.title,
				h.span(
					[
						h.Class(
							twMerge(
								sectionLabelStyles.required,
								options.isRequired && sectionLabelStyles.requiredShown,
							),
						),
					],
					["*"],
				),
			],
		),
		...(options.description
			? [
					h.p(
						[h.Class(twMerge(sectionLabelStyles.description, size.subheading))],
						[options.description],
					),
				]
			: []),
		...children,
	])
}

export const sectionLabelActions = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className?: string },
	children: ReadonlyArray<Html | string>,
): Html => h.div([h.Class(twMerge(sectionLabelStyles.actions, options.className))], [...children])
