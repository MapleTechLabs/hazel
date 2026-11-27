// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What every my-settings page repeats (today's `pageLayout`, `pageHeader` size `title` and
 * `my-settings/shared.ts` `settingsRow`): the page's column, its header, and the labelled rows.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"

export interface PageOptions {
	/** Names the page's column for the parity harness and tests (`data-hz-key`). */
	readonly id: string
	readonly title: string
	readonly subtitle: string
}

/**
 * The page: its header over the rows, 24px apart.
 * HAZEL-GAP(p4-settings-gutter): today's column is padded `px-4 lg:px-8`; no `stack` inset pads only
 * the sides, so the rows run to the section column's edges.
 */
export const SettingsPage = <Msg>(h: Hazel.H<Msg>, options: PageOptions, ...rows: ReadonlyArray<unknown>) =>
	h.stack
		.density("relaxed")
		.key(options.id)
		.children(
			h.stack
				.density("tight")
				.children(
					h.heading.size("large").children(options.title),
					h.text.role("label").tone("muted").children(options.subtitle),
				),
			h.stack.density("loose").children(...(rows as Array<never>)),
		)

export interface RowLabel {
	readonly title: string
	readonly description?: string
}

/**
 * One setting: its label (a 14px semibold title over a muted line) above its controls.
 * HAZEL-GAP(p4-settings-row): from today's `lg` the label is a 200 to 280px column beside the
 * controls (`lg:grid-cols-[minmax(200px,280px)_1fr] lg:gap-8`); here it always sits above them.
 */
export const SettingsRow = <Msg>(h: Hazel.H<Msg>, label: RowLabel, ...content: ReadonlyArray<unknown>) =>
	h.stack
		.density("loose")
		.children(
			h.stack
				.density("none")
				.children(
					h.heading.level("3").children(label.title),
					label.description === undefined
						? null
						: h.text.role("label").tone("muted").children(label.description),
				),
			...(content as Array<never>),
		)

/** A 14px medium label over a muted line, inside a row's controls (`Quiet hours`, `Notify me about`). */
export const FieldLabel = <Msg>(h: Hazel.H<Msg>, title: string, description?: string) =>
	h.stack
		.density("compact")
		.children(
			h.text.role("label").strong().children(title),
			description === undefined ? null : h.text.role("label").tone("muted").children(description),
		)
