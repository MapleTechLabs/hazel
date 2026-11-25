import type { Html, HtmlBuilder } from "foldkit/html"
import { IconMagnifier3, IconMapPin } from "../../../icons"
import { button } from "../../../ui/button"
import { emptyState } from "../../../ui/empty-state"
import { input, inputGroup } from "../../../ui/input"
import { Message } from "../message"
import type { StepOf } from "../model"
import { onboardingNavigation, stepHeader } from "../navigation"
import { cityCard } from "./city-card"
import { cityFor, filterCities } from "./data"
import { globeVisual } from "./globe"
import { timeRibbon } from "./ribbon"

/** `timezone-selection-step.tsx` */

type TimezoneForm = StepOf<"Timezone">

const toQuery = (value: string) => Message.ChangedTimezoneQuery({ value })

export const timezoneStep = (
	h: HtmlBuilder<Message>,
	form: TimezoneForm,
	options: { readonly browserTimezone: string; readonly nowMs: number },
): Html => {
	const detected = options.browserTimezone
	const selectedCity = form.selected === null ? null : cityFor(form.selected, options.nowMs)
	const isDetectedSelected = form.detectionAttempted && detected === form.selected
	const cities = filterCities(form.debouncedQuery, detected, options.nowMs)
	return h.div(
		[
			h.Class("space-y-4 sm:space-y-6 pb-16 sm:pb-0"),
			h.DataAttribute("testid", "onboarding-step-timezone"),
		],
		[
			stepHeader(h, {
				title: "Where are you located?",
				description:
					"Your teammates will see your local time, making it easier to communicate across time zones",
			}),
			h.div(
				[h.Class("rounded-2xl overflow-hidden")],
				[
					h.div(
						[
							h.Class(
								"relative bg-gradient-to-b from-muted/50 to-transparent p-4 pb-3 rounded-2xl border border-border sm:p-6 sm:pb-4",
							),
						],
						[
							globeVisual(h, {
								nowMs: options.nowMs,
								activeOffset: form.hoveredOffset ?? selectedCity?.offset ?? 0,
							}),
							timeRibbon(h, selectedCity?.offset ?? null),
						],
					),
					h.div(
						[h.Class("py-4 flex flex-col sm:flex-row gap-3")],
						[
							inputGroup(h, { className: "w-full" }, [
								IconMagnifier3(h),
								input(h, {
									placeholder: "Search time zones...",
									attributes: [
										h.Type("search"),
										h.AriaLabel("Search time zones"),
										h.Value(form.query),
										h.OnInput(toQuery),
									],
								}),
							]),
							button(
								h,
								{
									intent: isDetectedSelected ? "primary" : "outline",
									className: "gap-2 shrink-0",
									onPress: Message.ClickedDetectTimezone(),
								},
								[
									IconMapPin(h, { className: "size-4" }),
									isDetectedSelected
										? `Detected: ${cityFor(detected, options.nowMs).name}`
										: "Detect my time zone",
								],
							),
						],
					),
					h.div(
						[h.Class("py-4 sm:py-6 @container")],
						cities.length === 0
							? [
									emptyState(h, {
										title: "No time zones match",
										description: "Try a city, country or a name like Europe/Berlin.",
										role: "status",
										className: "py-8",
									}),
								]
							: [
									h.div(
										[
											h.Class(
												"grid grid-cols-1 @xs:grid-cols-2 @md:grid-cols-3 @lg:grid-cols-4 gap-3 max-h-[250px] sm:max-h-[400px] overflow-y-auto p-3 -m-3 pr-4",
											),
										],
										cities.map((city) =>
											cityCard(h, {
												city,
												isSelected: form.selected === city.timezone,
												isDetected: city.timezone === detected,
												nowMs: options.nowMs,
											}),
										),
									),
								],
					),
				],
			),
			onboardingNavigation(h, {
				onContinue: Message.ClickedContinueTimezone(),
				canContinue: form.selected !== null,
				isLoading: form.isSubmitting,
			}),
		],
	)
}
