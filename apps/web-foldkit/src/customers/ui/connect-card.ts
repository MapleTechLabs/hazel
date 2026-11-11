import type { CustomerProvider } from "@hazel/domain/customers"
import { Match } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconArrowPath, IconPlus } from "../../icons"
import { button } from "../../ui/button"
import { loader } from "../../ui/loader"
import { progressBar, progressBarTrack } from "../../ui/progress-bar"
import { formatCount, formatRelative, type Instant } from "../format"
import { providerOf } from "../providers"
import { SOURCE_LABEL, sourceMark } from "./identity"

/**
 * A data source card (Foundations › Integration Connect Cards): what the source brings, then its
 * state: not connected, syncing with progress, connected, or failing with the way out.
 */

export type ConnectCardStatus<M> =
	| Readonly<{ _tag: "NotConnected"; onConnect: M }>
	| Readonly<{
			_tag: "Syncing"
			/** `invoices`. */
			step: string
			done: number
			total: number | null
			onCancel?: M
	  }>
	| Readonly<{
			_tag: "Connected"
			syncedAt: Instant | null
			/** `214 organizations · 1,862 users`. */
			summary: string
			onSyncNow?: M
	  }>
	| Readonly<{
			_tag: "Error"
			at: Instant
			/** `API key was revoked. Last good sync Nov 9, 18:42.` */
			message: string
			action: Readonly<{ label: string; onPress: M }>
	  }>

const statusLine = <M>(
	h: HtmlBuilder<M>,
	dotClass: string,
	label: string,
	labelClass: string,
	rest: string | null,
): Html =>
	h.p(
		[h.Class("flex items-center gap-1.5 text-sm")],
		[
			h.span([h.AriaHidden(true), h.Class(twMerge("size-1.5 shrink-0 rounded-full", dotClass))]),
			h.span([h.Class(labelClass)], [label]),
			...(rest === null ? [] : [h.span([h.Class("text-muted-fg")], [`· ${rest}`])]),
		],
	)

export const connectCard = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		provider: CustomerProvider
		status: ConnectCardStatus<M>
		now: Instant
		description?: string
		className?: string
	}>,
): Html => {
	const { status } = options
	const footer: ReadonlyArray<Html> = Match.valueTags(status, {
		NotConnected: (status) => [
			statusLine(h, "bg-muted-fg", "Not connected", "text-muted-fg", null),
			button(h, { intent: "primary", size: "sm", onPress: status.onConnect }, [IconPlus(h), "Connect"]),
		],
		Syncing: (status) => {
			const pct =
				status.total === null || status.total === 0 ? null : (status.done / status.total) * 100
			const counts =
				status.total === null
					? `${formatCount(status.done)} ${status.step}`
					: `${formatCount(status.done)} of ${formatCount(status.total)} ${status.step}`
			return [
				h.div(
					[h.Class("flex min-w-0 flex-1 flex-col gap-2")],
					[
						h.p(
							[h.Class("flex items-center gap-1.5 text-sm")],
							[
								loader(h, {
									ariaLabel: "Syncing",
									className: "size-3.5 text-primary-subtle-fg",
								}),
								h.span([h.Class("font-medium text-primary-subtle-fg")], ["Syncing…"]),
								h.span([h.Class("truncate text-muted-fg tabular-nums")], [counts]),
							],
						),
						progressBar(
							h,
							{
								ariaLabel: `Syncing ${status.step}`,
								...(pct === null ? { isIndeterminate: true } : { value: pct }),
							},
							[progressBarTrack(h, pct === null ? { isIndeterminate: true } : { value: pct })],
						),
					],
				),
				...(status.onCancel === undefined
					? []
					: [button(h, { intent: "plain", size: "sm", onPress: status.onCancel }, ["Cancel"])]),
			]
		},
		Connected: (status) => [
			h.div(
				[h.Class("flex min-w-0 flex-col gap-0.5")],
				[
					statusLine(
						h,
						"bg-success-subtle-fg",
						"Connected",
						"font-medium text-success-subtle-fg",
						status.syncedAt === null
							? "Not synced yet"
							: `Synced ${formatRelative(status.syncedAt, options.now)}`,
					),
					h.p([h.Class("text-muted-fg text-sm tabular-nums")], [status.summary]),
				],
			),
			...(status.onSyncNow === undefined
				? []
				: [
						button(h, { intent: "outline", size: "sm", onPress: status.onSyncNow }, [
							IconArrowPath(h),
							"Sync now",
						]),
					]),
		],
		Error: (status) => [
			h.div(
				[h.Class("flex min-w-0 flex-col gap-0.5")],
				[
					statusLine(
						h,
						"bg-danger-subtle-fg",
						"Sync failed",
						"font-medium text-danger-subtle-fg",
						formatRelative(status.at, options.now),
					),
					h.p([h.Class("text-muted-fg text-sm")], [status.message]),
				],
			),
			button(h, { intent: "outline", size: "sm", onPress: status.action.onPress }, [
				status.action.label,
			]),
		],
	})
	return h.article(
		[
			h.AriaLabel(SOURCE_LABEL[options.provider]),
			h.Class(
				twMerge(
					"flex flex-col gap-4 rounded-xl border border-border bg-bg p-4 sm:p-5",
					options.className,
				),
			),
		],
		[
			h.div(
				[h.Class("flex items-start gap-3")],
				[
					sourceMark(h, options.provider, { size: "md" }),
					h.div(
						[h.Class("flex min-w-0 flex-col gap-0.5")],
						[
							h.h3(
								[h.Class("font-medium text-base/6 text-fg")],
								[SOURCE_LABEL[options.provider]],
							),
							h.p(
								[h.Class("text-muted-fg text-sm")],
								[options.description ?? providerOf(options.provider).blurb],
							),
						],
					),
				],
			),
			h.div([h.Class("flex items-center justify-between gap-4 border-border border-t pt-4")], footer),
		],
	)
}
