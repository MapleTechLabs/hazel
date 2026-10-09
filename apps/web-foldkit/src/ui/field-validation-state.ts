import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	validationStateIconStyles,
	validationStateStyles,
} from "~/components/ui/field-validation-state.styles"
import { IconCheck, IconLoader } from "../icons"

/** Port of `components/ui/field-validation-state.tsx`. Renders nothing while idle. */
export type ValidationState = "idle" | "validating" | "valid" | "invalid"

const invalidIcon = <Message>(h: HtmlBuilder<Message>): Html =>
	h.svg(
		[
			h.Class(validationStateIconStyles),
			h.Attribute("viewBox", "0 0 12 12"),
			h.Attribute("fill", "none"),
			h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
			h.Attribute("aria-hidden", "true"),
		],
		[
			h.path([
				h.Attribute("d", "M2.25 9.75L9.75 2.25M9.75 9.75L2.25 2.25"),
				h.Attribute("stroke", "currentColor"),
				h.Attribute("stroke-width", "1.5"),
				h.Attribute("stroke-linecap", "round"),
				h.Attribute("stroke-linejoin", "round"),
			]),
		],
	)

export const fieldValidationState = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly state: ValidationState; readonly className?: string },
): Html =>
	options.state === "idle"
		? null
		: h.span(
				[
					h.Class(twMerge(validationStateStyles({ state: options.state }), options.className)),
					h.AriaHidden(true),
				],
				[
					options.state === "validating"
						? IconLoader(h, { className: validationStateIconStyles, title: "Validating..." })
						: options.state === "valid"
							? IconCheck(h, { className: validationStateIconStyles, title: "Valid" })
							: invalidIcon(h),
				],
			)

/** Legacy `getValidationState`: TanStack Form field meta to a state. */
export const getValidationState = (meta: {
	readonly isValidating?: boolean
	readonly isTouched?: boolean
	readonly errors?: ReadonlyArray<unknown>
}): ValidationState => {
	if (meta.isValidating) return "validating"
	if (meta.isTouched) return meta.errors?.length ? "invalid" : "valid"
	return "idle"
}
