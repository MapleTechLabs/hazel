import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { loaderStyles } from "~/components/ui/loader.styles"

/** Port of `components/ui/loader.tsx`: an indeterminate React Aria ProgressBar around a spinner. */
export type LoaderVariant = "ring" | "spin"

const SPIN_LINES: ReadonlyArray<Readonly<Record<string, string>>> = [
	{ x1: "1200", y1: "600", x2: "1200", y2: "100" },
	{ opacity: "0.5", x1: "1200", y1: "2300", x2: "1200", y2: "1800" },
	{ opacity: "0.917", x1: "900", y1: "680.4", x2: "650", y2: "247.4" },
	{ opacity: "0.417", x1: "1750", y1: "2152.6", x2: "1500", y2: "1719.6" },
	{ opacity: "0.833", x1: "680.4", y1: "900", x2: "247.4", y2: "650" },
	{ opacity: "0.333", x1: "2152.6", y1: "1750", x2: "1719.6", y2: "1500" },
	{ opacity: "0.75", x1: "600", y1: "1200", x2: "100", y2: "1200" },
	{ opacity: "0.25", x1: "2300", y1: "1200", x2: "1800", y2: "1200" },
	{ opacity: "0.667", x1: "680.4", y1: "1500", x2: "247.4", y2: "1750" },
	{ opacity: "0.167", x1: "2152.6", y1: "650", x2: "1719.6", y2: "900" },
	{ opacity: "0.583", x1: "900", y1: "1719.6", x2: "650", y2: "2152.6" },
	{ opacity: "0.083", x1: "1750", y1: "247.4", x2: "1500", y2: "680.4" },
]

const attributes = <Message>(h: HtmlBuilder<Message>, record: Readonly<Record<string, string>>) =>
	Object.entries(record).map(([name, value]) => h.Attribute(name, value))

const ring = <Message>(h: HtmlBuilder<Message>, className: string, ariaLabel: string | undefined): Html =>
	h.svg(
		[
			h.Class(twMerge(loaderStyles.svg, className)),
			h.Role("presentation"),
			...attributes(h, {
				xmlns: "http://www.w3.org/2000/svg",
				width: "16",
				height: "16",
				fill: "none",
				viewBox: "0 0 24 24",
				"aria-hidden": "true",
			}),
			// NOTE: legacy spreads the Loader's remaining props, aria-label included, onto the svg.
			...(ariaLabel === undefined ? [] : [h.AriaLabel(ariaLabel)]),
		],
		[
			h.path(
				attributes(h, {
					stroke: "currentColor",
					"stroke-opacity": "0.25",
					"stroke-width": "3.636",
					d: "M11.909 21a9.09 9.09 0 1 0 0-18.182 9.09 9.09 0 0 0 0 18.182Z",
				}),
			),
			h.path(
				attributes(h, {
					fill: "currentColor",
					d: "M4.636 11.91a7.273 7.273 0 0 1 7.273-7.274V1C5.885 1 1 5.885 1 11.91zm1.819 4.81a7.24 7.24 0 0 1-1.819-4.81H1c0 2.764 1.032 5.294 2.727 7.215z",
				}),
			),
		],
	)

const spin = <Message>(h: HtmlBuilder<Message>, className: string, ariaLabel: string | undefined): Html =>
	h.svg(
		[
			h.Class(twMerge(loaderStyles.svg, className)),
			h.Attribute("viewBox", "0 0 2400 2400"),
			h.Role("presentation"),
			...(ariaLabel === undefined ? [] : [h.AriaLabel(ariaLabel)]),
		],
		[
			h.g(attributes(h, { "stroke-width": "200", "stroke-linecap": "round", fill: "none" }), [
				...SPIN_LINES.map((line) => h.line(attributes(h, line))),
				h.animateTransform(
					attributes(h, {
						attributeName: "transform",
						attributeType: "XML",
						type: "rotate",
						keyTimes:
							"0;0.08333;0.16667;0.25;0.33333;0.41667;0.5;0.58333;0.66667;0.75;0.83333;0.91667",
						values: "0 1199 1199;30 1199 1199;60 1199 1199;90 1199 1199;120 1199 1199;150 1199 1199;180 1199 1199;210 1199 1199;240 1199 1199;270 1199 1199;300 1199 1199;330 1199 1199",
						dur: "0.83333s",
						begin: "0.08333s",
						repeatCount: "indefinite",
						calcMode: "discrete",
					}),
				),
			]),
		],
	)

export const loader = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly variant?: LoaderVariant
		readonly ariaLabel?: string
		readonly className?: string
	} = {},
): Html => {
	const variant = options.variant ?? "spin"
	const className = twMerge(...loaderStyles.loader(variant), options.className)
	return h.div(
		[
			h.AriaLabel(options.ariaLabel ?? "Pending..."),
			h.AriaValuemax(100),
			h.AriaValuemin(0),
			h.Class("react-aria-ProgressBar"),
			h.Attribute("data-rac", ""),
			h.Attribute("data-slot", "loader"),
			h.Role("progressbar"),
		],
		[variant === "ring" ? ring(h, className, options.ariaLabel) : spin(h, className, options.ariaLabel)],
	)
}
