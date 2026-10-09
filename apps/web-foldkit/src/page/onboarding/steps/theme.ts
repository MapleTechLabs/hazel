import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { appearanceDark, appearanceLight, appearanceSystem } from "../../../ui/appearance-previews"
import { visuallyHiddenStyle } from "../../../ui/checkbox"
import { Message } from "../message"
import type { ThemeState } from "../../../theme"
import type { Theme } from "../model"
import { onboardingNavigation, stepHeader } from "../navigation"

/** `theme-selection-step.tsx`: React Aria's unstyled RadioGroup/Radio with ColorSwatch and previews. */


/** `parseColor(hex).getColorName("en-US")` for each swatch. */
const SWATCHES = [
	{ hex: "#535862", name: "dark grayish blue" },
	{ hex: "#099250", name: "green" },
	{ hex: "#1570EF", name: "vibrant cyan blue" },
	{ hex: "#444CE7", name: "dark vibrant blue" },
	{ hex: "#6938EF", name: "dark vibrant purple" },
	{ hex: "#BA24D5", name: "vibrant magenta" },
	{ hex: "#DD2590", name: "vibrant pink" },
	{ hex: "#E04F16", name: "vibrant red orange" },
] as const

const THEMES: ReadonlyArray<{ value: Theme; label: string; preview: (h: HtmlBuilder<Message>) => Html }> = [
	{ value: "system", label: "System preference", preview: appearanceSystem },
	{ value: "light", label: "Light mode", preview: appearanceLight },
	{ value: "dark", label: "Dark mode", preview: appearanceDark },
]

const rgbOf = (hex: string) => {
	const value = Number.parseInt(hex.slice(1), 16)
	return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

/** React Aria's `<Radio>`: a label around a visually hidden input. */
const ariaRadio = (
	h: HtmlBuilder<Message>,
	options: {
		readonly name: string
		readonly value: string
		readonly ariaLabel: string
		readonly isSelected: boolean
		readonly className: string
		readonly onSelect: Message
	},
	children: Array<Html>,
): Html =>
	h.label(
		[
			h.Class(options.className),
			h.DataAttribute("rac", ""),
			h.DataAttribute("react-aria-pressable", "true"),
			...(options.isSelected ? [h.DataAttribute("selected", "true")] : []),
		],
		[
			h.span(
				[h.Attribute("style", visuallyHiddenStyle)],
				[
					h.input([
						h.AriaLabel(options.ariaLabel),
						h.DataAttribute("react-aria-pressable", "true"),
						h.Name(options.name),
						h.Attribute("style", ""),
						h.Tabindex(options.isSelected ? 0 : -1),
						h.Attribute("title", ""),
						h.Type("radio"),
						h.Attribute("value", options.value),
						h.Checked(options.isSelected),
						h.OnChange(() => options.onSelect),
					]),
				],
			),
			...children,
		],
	)

const radioGroup = (h: HtmlBuilder<Message>, ariaLabel: string, className: string, children: Array<Html>) =>
	h.div(
		[
			h.AriaLabel(ariaLabel),
			h.Attribute("aria-orientation", "vertical"),
			h.Class(className),
			h.DataAttribute("orientation", "vertical"),
			h.DataAttribute("rac", ""),
			h.Role("radiogroup"),
		],
		children,
	)

const brandColors = (h: HtmlBuilder<Message>, theme: ThemeState): Html =>
	radioGroup(h, "Brand color", "flex items-center", [
		h.div(
			[h.Class("flex flex-wrap gap-2")],
			SWATCHES.map((swatch) => {
				const isSelected = theme.customization.primary.toLowerCase() === swatch.hex.toLowerCase()
				return ariaRadio(
					h,
					{
						name: "onboarding-brand-color",
						value: swatch.hex,
						ariaLabel: swatch.name,
						isSelected,
						className: "react-aria-Radio",
						onSelect: Message.SelectedBrandColor({ hex: swatch.hex }),
					},
					[
						h.div(
							[
								h.AriaLabel(swatch.name),
								h.Attribute("aria-roledescription", "color swatch"),
								h.Class(
									twMerge(
										"size-7 cursor-pointer rounded-full outline-1 outline-black/10 -outline-offset-1",
										isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-bg",
									),
								),
								h.DataAttribute("rac", ""),
								h.Id(`color-${swatch.hex}`),
								h.Role("img"),
								h.Attribute(
									"style",
									`background-color: ${rgbOf(swatch.hex)}; forced-color-adjust: none;`,
								),
							],
						),
					],
				)
			}),
		),
	])

const displayPreferences = (h: HtmlBuilder<Message>, theme: ThemeState): Html =>
	radioGroup(
		h,
		"Display preference",
		"flex gap-4 sm:gap-5",
		THEMES.map((option) => {
			const isSelected = theme.mode === option.value
			return ariaRadio(
				h,
				{
					name: "onboarding-display-preference",
					value: option.value,
					ariaLabel: option.label,
					isSelected,
					className: "flex shrink-0 cursor-pointer flex-col gap-2 sm:gap-3",
					onSelect: Message.SelectedTheme({ theme: option.value }),
				},
				[
					h.section(
						[
							h.Class(
								twMerge(
									"relative h-24 w-36 rounded-[10px] bg-secondary sm:h-33 sm:w-50",
									isSelected && "outline-2 outline-ring outline-offset-2",
								),
							),
						],
						[
							option.preview(h),
							...(isSelected
								? [
										h.div(
											[
												h.Class(
													"absolute bottom-2 left-2 flex size-5 items-center justify-center rounded-full border-2 border-fg bg-primary",
												),
											],
											[h.div([h.Class("size-2.5 rounded-full bg-fg")])],
										),
									]
								: []),
						],
					),
					h.section(
						[h.Class("w-full")],
						[h.p([h.Class("font-semibold text-fg text-sm")], [option.label])],
					),
				],
			)
		}),
	)

const sectionHeading = (h: HtmlBuilder<Message>, title: string, description: string): Array<Html> => [
	h.p([h.Class("block font-medium text-sm")], [title]),
	h.p([h.Class("text-muted-fg text-sm")], [description]),
]

export const themeStep = (h: HtmlBuilder<Message>, theme: ThemeState): Html =>
	h.div(
		[h.Class("space-y-4 sm:space-y-6"), h.DataAttribute("testid", "onboarding-step-theme")],
		[
			stepHeader(h, {
				title: "Choose your theme",
				description: "Customize how Hazel looks and feels for you",
			}),
			h.div(
				[h.Class("space-y-4 sm:space-y-6")],
				[
					h.div(
						[h.Class("space-y-3")],
						[
							...sectionHeading(h, "Brand color", "Select your preferred accent color"),
							brandColors(h, theme),
						],
					),
					h.hr([h.Class("h-px w-full border-none bg-border")]),
					h.div(
						[h.Class("space-y-3")],
						[
							...sectionHeading(h, "Display preference", "Switch between light and dark modes"),
							h.div(
								[
									h.Class(
										"-mx-3 overflow-x-auto px-3 pt-2 sm:mx-0 sm:overflow-x-visible sm:px-0",
									),
								],
								[displayPreferences(h, theme)],
							),
						],
					),
				],
			),
			onboardingNavigation(h, { onContinue: Message.ClickedContinueTheme() }),
		],
	)
