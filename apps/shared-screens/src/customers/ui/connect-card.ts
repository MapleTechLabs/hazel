// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A data source card (today's `web-foldkit/src/customers/ui/connect-card.ts`): what the source
 * brings, then its state: not connected, syncing with progress, connected, or failing with the way out.
 */
import type { CustomerProvider } from "@hazel/domain/customers"
import type { Hazel, TextTone } from "@hazel/ui/vocabulary/index"
import { Match } from "effect"
import { formatCount, formatRelative, type Instant } from "../data/format"
import { providerOf, sourceLabel } from "../data/providers"
import { sourceMark } from "./identity"

export type ConnectCardStatus<Msg> =
	| Readonly<{ _tag: "NotConnected"; onConnect: Msg }>
	| Readonly<{
			_tag: "Syncing"
			/** `invoices`. */
			step: string
			done: number
			total: number | null
			onCancel?: Msg
	  }>
	| Readonly<{
			_tag: "Connected"
			syncedAt: Instant | null
			/** `214 organizations · 1,862 users`. */
			summary: string
			onSyncNow?: Msg
	  }>
	| Readonly<{
			_tag: "Error"
			at: Instant
			/** `API key was revoked. Last good sync Nov 9, 18:42.` */
			message: string
			action: Readonly<{ label: string; onPress: Msg }>
	  }>

/** `● Connected · Synced 2h ago`: the state in its tone, then the rest muted. */
const stateLine = <Msg>(h: Hazel.H<Msg>, tone: TextTone, label: string, rest: string | null) =>
	// HAZEL-GAP(p4-customers-status-dot): today's state leads with the kit's status dot in its tone; `text` has no dot.
	h.stack
		.axis("horizontal")
		.density("compact")
		.align("center")
		.children(
			h.text
				.strong(tone !== "muted")
				.tone(tone)
				.children(label),
			rest === null ? null : h.text.tone("muted").children(`· ${rest}`),
		)

const footer = <Msg>(h: Hazel.H<Msg>, status: ConnectCardStatus<Msg>, now: Instant) =>
	Match.valueTags(status, {
		NotConnected: (status) => [
			stateLine(h, "muted", "Not connected", null),
			h.button.label("Connect").icon("plus").size("small").on("press", status.onConnect),
		],
		Syncing: (status) => {
			const counts =
				status.total === null
					? `${formatCount(status.done)} ${status.step}`
					: `${formatCount(status.done)} of ${formatCount(status.total)} ${status.step}`
			const known = status.total !== null && status.total > 0
			return [
				h.stack.density("compact").children(
					// HAZEL-GAP(p4-customers-inline-spinner): today's line leads with a 14px loader ring in the accent ink; a `progress` spinner is its own row.
					h.stack
						.axis("horizontal")
						.density("compact")
						.align("center")
						.children(
							h.text.strong().tone("accent").children("Syncing…"),
							h.text.tone("muted").numeric().truncate().children(counts),
						),
					known
						? h.progress.value(status.done / (status.total ?? 1)).label(`Syncing ${status.step}`)
						: h.progress.indeterminate().label(`Syncing ${status.step}`),
				),
				status.onCancel === undefined
					? null
					: h.button.label("Cancel").variant("ghost").size("small").on("press", status.onCancel),
			]
		},
		Connected: (status) => [
			h.stack
				.density("tight")
				.children(
					stateLine(
						h,
						"success",
						"Connected",
						status.syncedAt === null
							? "Not synced yet"
							: `Synced ${formatRelative(status.syncedAt, now)}`,
					),
					h.text.tone("muted").numeric().children(status.summary),
				),
			status.onSyncNow === undefined
				? null
				: h.button
						.label("Sync now")
						.icon("refresh")
						.variant("outline")
						.size("small")
						.on("press", status.onSyncNow),
		],
		Error: (status) => [
			h.stack
				.density("tight")
				.children(
					stateLine(h, "danger", "Sync failed", formatRelative(status.at, now)),
					h.text.tone("muted").children(status.message),
				),
			h.button
				.label(status.action.label)
				.variant("outline")
				.size("small")
				.on("press", status.action.onPress),
		],
	})

export const connectCard = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		provider: CustomerProvider
		status: ConnectCardStatus<Msg>
		now: Instant
		description?: string
	}>,
) =>
	// HAZEL-GAP(p4-customers-card-footer): today the footer sits under a hairline with its parts at either end (`justify-between`); a stack has no divider-topped row or space-between, so a `divider` and a `spacer` stand in.
	h.frame.children(
		h.stack.children(
			h.stack
				.axis("horizontal")
				.align("start")
				.children(
					sourceMark(h, options.provider, { size: "md" }),
					h.stack
						.density("tight")
						.children(
							h.heading.level("3").children(sourceLabel(options.provider)),
							h.text
								.tone("muted")
								.children(options.description ?? providerOf(options.provider).blurb),
						),
				),
			h.divider,
			h.stack
				.axis("horizontal")
				.align("center")
				.children(...withSpacer(h, footer(h, options.status, options.now))),
		),
	)

/** The footer's start, a spacer, then its end (today's `justify-between`). */
const withSpacer = <Msg, A>(h: Hazel.H<Msg>, parts: ReadonlyArray<A>) => {
	const [first, ...rest] = parts
	return [first ?? null, h.spacer, ...rest]
}
