import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"

/** Port of `components/ui/loader.tsx`: a React Aria ProgressBar wrapping the ring or spin SVG. */
export type LoaderVariant = "ring" | "spin"

const spinLines: ReadonlyArray<readonly [string | null, string, string, string, string]> = [
	[null, "1200", "600", "1200", "100"],
	["0.5", "1200", "2300", "1200", "1800"],
	["0.917", "900", "680.4", "650", "247.4"],
	["0.417", "1750", "2152.6", "1500", "1719.6"],
	["0.833", "680.4", "900", "247.4", "650"],
	["0.333", "2152.6", "1750", "1719.6", "1500"],
	["0.75", "600", "1200", "100", "1200"],
	["0.25", "2300", "1200", "1800", "1200"],
	["0.667", "680.4", "1500", "247.4", "1750"],
	["0.167", "2152.6", "650", "1719.6", "900"],
	["0.583", "900", "1719.6", "650", "2152.6"],
	["0.083", "1750", "247.4", "1500", "680.4"],
]

const ring = <Message>(h: HtmlBuilder<Message>, className: string): Html =>
	h.svg(
		[
			h.Class(twMerge("size-4", className)),
			h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
			h.Attribute("width", "16"),
			h.Attribute("height", "16"),
			h.Attribute("fill", "none"),
			h.Attribute("viewBox", "0 0 24 24"),
			h.Attribute("aria-hidden", "true"),
			h.Attribute("role", "presentation"),
		],
		[
			h.path(
				[
					h.Attribute("stroke", "currentColor"),
					h.Attribute("stroke-opacity", "0.25"),
					h.Attribute("stroke-width", "3.636"),
					h.Attribute("d", "M11.909 21a9.09 9.09 0 1 0 0-18.182 9.09 9.09 0 0 0 0 18.182Z"),
				],
				[],
			),
			h.path(
				[
					h.Attribute("fill", "currentColor"),
					h.Attribute(
						"d",
						"M4.636 11.91a7.273 7.273 0 0 1 7.273-7.274V1C5.885 1 1 5.885 1 11.91zm1.819 4.81a7.24 7.24 0 0 1-1.819-4.81H1c0 2.764 1.032 5.294 2.727 7.215z",
					),
				],
				[],
			),
		],
	)

const spin = <Message>(h: HtmlBuilder<Message>, className: string): Html =>
	h.svg(
		[
			h.Class(twMerge("size-4", className)),
			h.Attribute("viewBox", "0 0 2400 2400"),
			h.Attribute("role", "presentation"),
		],
		[
			h.g(
				[
					h.Attribute("stroke-width", "200"),
					h.Attribute("stroke-linecap", "round"),
					h.Attribute("fill", "none"),
				],
				[
					...spinLines.map(([opacity, x1, y1, x2, y2]) =>
						h.line(
							[
								...(opacity === null ? [] : [h.Attribute("opacity", opacity)]),
								h.Attribute("x1", x1),
								h.Attribute("y1", y1),
								h.Attribute("x2", x2),
								h.Attribute("y2", y2),
							],
							[],
						),
					),
					h.animateTransform(
						[
							h.Attribute("attributeName", "transform"),
							h.Attribute("attributeType", "XML"),
							h.Attribute("type", "rotate"),
							h.Attribute(
								"keyTimes",
								"0;0.08333;0.16667;0.25;0.33333;0.41667;0.5;0.58333;0.66667;0.75;0.83333;0.91667",
							),
							h.Attribute(
								"values",
								"0 1199 1199;30 1199 1199;60 1199 1199;90 1199 1199;120 1199 1199;150 1199 1199;180 1199 1199;210 1199 1199;240 1199 1199;270 1199 1199;300 1199 1199;330 1199 1199",
							),
							h.Attribute("dur", "0.83333s"),
							h.Attribute("begin", "0.08333s"),
							h.Attribute("repeatCount", "indefinite"),
							h.Attribute("calcMode", "discrete"),
						],
						[],
					),
				],
			),
		],
	)

export const loader = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly variant?: LoaderVariant; readonly className?: string; readonly label?: string } = {},
): Html => {
	const variant = options.variant ?? "spin"
	const className = twMerge(
		"size-4",
		variant === "ring" && "animate-spin",
		variant === "spin" && "stroke-current",
		options.className,
	)
	return h.div(
		[
			h.Class("react-aria-ProgressBar"),
			h.DataAttribute("rac", ""),
			h.DataAttribute("slot", "loader"),
			h.Role("progressbar"),
			h.AriaLabel(options.label ?? "Pending..."),
			h.Attribute("aria-valuemin", "0"),
			h.Attribute("aria-valuemax", "100"),
		],
		[variant === "ring" ? ring(h, className) : spin(h, className)],
	)
}
