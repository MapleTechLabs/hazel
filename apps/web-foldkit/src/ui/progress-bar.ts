import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { progressBarStyles } from "~/components/ui/progress-bar.styles"

/** Port of `components/ui/progress-bar.tsx` (React Aria ProgressBar, 0 to 100). */
export interface ProgressBarState {
	readonly value?: number
	readonly isIndeterminate?: boolean
}

const percentFormat = new Intl.NumberFormat("en-US", { style: "percent" })

const percentageOf = (state: ProgressBarState) => Math.min(100, Math.max(0, state.value ?? 0))

/** RA's default `valueText`: the percentage formatted for en-US. */
export const valueText = (state: ProgressBarState) => percentFormat.format(percentageOf(state) / 100)

export const progressBar = <Message>(
	h: HtmlBuilder<Message>,
	options: ProgressBarState & { readonly ariaLabel: string; readonly className?: string },
	children: ReadonlyArray<Html | string>,
): Html =>
	h.div(
		[
			h.AriaLabel(options.ariaLabel),
			...(options.isIndeterminate
				? []
				: [h.AriaValuenow(percentageOf(options)), h.AriaValuetext(valueText(options))]),
			h.AriaValuemax(100),
			h.AriaValuemin(0),
			h.Class(twMerge(twMerge(...progressBarStyles.root), options.className)),
			h.Attribute("data-rac", ""),
			h.Attribute("data-slot", "control"),
			h.Role("progressbar"),
		],
		[...children],
	)

export const progressBarHeader = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className?: string },
	children: ReadonlyArray<Html | string>,
): Html =>
	h.div(
		[
			h.Attribute("data-slot", "progress-bar-header"),
			h.Class(twMerge(progressBarStyles.header, options.className)),
		],
		[...children],
	)

export const progressBarValue = <Message>(
	h: HtmlBuilder<Message>,
	options: ProgressBarState & { readonly className?: string },
): Html => h.span([h.Class(twMerge(progressBarStyles.value, options.className))], [valueText(options)])

export const progressBarTrack = <Message>(
	h: HtmlBuilder<Message>,
	options: ProgressBarState & { readonly className?: string },
): Html =>
	h.span(
		[h.Attribute("data-slot", "progress-bar-track"), h.Class(progressBarStyles.track)],
		[
			h.style([], [progressBarStyles.keyframes]),
			h.div(
				[h.Class(progressBarStyles.trackInner)],
				[
					h.div(
						[h.Class(twMerge(progressBarStyles.bar, options.className))],
						[
							options.isIndeterminate
								? h.div([
										h.Attribute("data-slot", "progress-content"),
										h.Class(progressBarStyles.fillIndeterminate),
										h.Attribute("style", "width: 40%;"),
									])
								: h.div([
										h.Attribute("data-slot", "progress-content"),
										h.Class(progressBarStyles.fill),
										h.Attribute("style", `width: ${percentageOf(options)}%;`),
									]),
						],
					),
				],
			),
		],
	)
