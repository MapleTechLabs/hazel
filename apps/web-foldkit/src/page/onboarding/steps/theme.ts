import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { ariaRadioGroup } from "../../../ui/aria-radio"
import { separator } from "../../../ui/separator"
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

/** Static illustrations in `public/images/appearance`. */
const THEMES: ReadonlyArray<{ value: Theme; label: string; preview: string }> = [
	{ value: "system", label: "System preference", preview: "/images/appearance/system.svg" },
	{ value: "light", label: "Light mode", preview: "/images/appearance/light.svg" },
	{ value: "dark", label: "Dark mode", preview: "/images/appearance/dark.svg" },
]

const rgbOf = (hex: string) => {
	const value = Number.parseInt(hex.slice(1), 16)
	return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

const brandColors = (h: HtmlBuilder<Message>, theme: ThemeState): Html =>
	ariaRadioGroup(
		h,
		{
			id: "onboarding-brand-color",
			value:
				SWATCHES.find(
					(swatch) => swatch.hex.toLowerCase() === theme.customization.primary.toLowerCase(),
				)?.hex ?? null,
			onChange: (hex) => Message.SelectedBrandColor({ hex }),
			ariaLabel: "Brand color",
			className: "flex items-center",
		},
		(radio) => [
			h.div(
				[h.Class("flex flex-wrap gap-2")],
				SWATCHES.map((swatch) =>
					radio(
						swatch.hex,
						{ className: "react-aria-Radio", ariaLabel: swatch.name },
						({ isSelected }) => [
							h.div([
								h.AriaLabel(swatch.name),
								h.Attribute("aria-roledescription", "color swatch"),
								h.Class(
									twMerge(
										"size-7 cursor-pointer rounded-full outline-1 outline-black/10 -outline-offset-1",
										isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-bg",
									),
								),
								h.Id(`color-${swatch.hex}`),
								h.Role("img"),
								h.Attribute(
									"style",
									`background-color: ${rgbOf(swatch.hex)}; forced-color-adjust: none;`,
								),
							]),
						],
					),
				),
			),
		],
	)

const isTheme = (value: string): value is Theme => THEMES.some((option) => option.value === value)

const displayPreferences = (h: HtmlBuilder<Message>, theme: ThemeState): Html =>
	ariaRadioGroup(
		h,
		{
			id: "onboarding-display-preference",
			value: theme.mode,
			onChange: (value) => Message.SelectedTheme({ theme: isTheme(value) ? value : "system" }),
			ariaLabel: "Display preference",
			className: "flex gap-4 sm:gap-5",
		},
		(radio) =>
			THEMES.map((option) =>
				radio(
					option.value,
					{
						className: "flex shrink-0 cursor-pointer flex-col gap-2 sm:gap-3",
						ariaLabel: option.label,
					},
					({ isSelected }) => [
						h.section(
							[
								h.Class(
									twMerge(
										"relative h-24 w-36 rounded-xl bg-secondary sm:h-33 sm:w-50",
										isSelected && "outline-2 outline-ring outline-offset-2",
									),
								),
							],
							[
								h.img([
									h.Src(option.preview),
									h.Alt(""),
									h.Attribute("draggable", "false"),
									h.Class("size-full"),
								]),
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
				),
			),
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
					separator(h),
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
