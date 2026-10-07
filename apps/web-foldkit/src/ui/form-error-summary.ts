import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formErrorSummaryPartStyles, formErrorSummaryStyles } from "~/components/ui/form-error-summary.styles"

/** Port of `components/ui/form-error-summary.tsx`. Renders nothing without errors. */
export interface FormError {
	readonly field: string
	readonly message: string
}

export const formErrorSummary = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly errors: ReadonlyArray<FormError>
		readonly title?: string
		readonly className?: string
	},
): Html =>
	options.errors.length === 0
		? null
		: h.div(
				[
					h.Class(twMerge(formErrorSummaryStyles(), options.className)),
					h.Role("alert"),
					h.AriaLive("polite"),
				],
				[
					h.p(
						[h.Class(formErrorSummaryPartStyles.title)],
						[options.title ?? "Please fix the following errors:"],
					),
					h.ul(
						[h.Class(formErrorSummaryPartStyles.list)],
						options.errors.map((error) =>
							h.li(
								[],
								// React writes `{field}:` and ` {message}` as separate text nodes.
								[
									h.span([h.Class(formErrorSummaryPartStyles.field)], [error.field, ":"]),
									" ",
									error.message,
								],
							),
						),
					),
				],
			)
