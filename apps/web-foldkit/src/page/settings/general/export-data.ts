import type { OrganizationExport } from "@hazel/domain/models"
import { DateTime } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconDownload } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardBody, cardHeader } from "../../../ui/card"
import { heading } from "../../../ui/heading"
import { progressBar, progressBarTrack } from "../../../ui/progress-bar"
import { Message } from "./message"
import { ExportStart, type Model } from "./model"

/** The "Export data" card of the general settings (owners and admins). */

type Export = OrganizationExport.Type

const toMillis = (value: Export["createdAt"]): number =>
	value instanceof Date ? value.getTime() : DateTime.toEpochMillis(value)

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export const isExportActive = (row: Export) => row.status === "pending" || row.status === "running"

export const isExportExpired = (row: Export, now: number) =>
	row.expiresAt !== null && toMillis(row.expiresAt) <= now

const statusBadge = (h: HtmlBuilder<Message>, row: Export, now: number): Html => {
	if (row.status === "ready" && isExportExpired(row, now))
		return badge(h, { intent: "muted", size: "sm" }, ["Expired"])
	switch (row.status) {
		case "pending":
			return badge(h, { intent: "quiet", size: "sm" }, ["Queued"])
		case "running":
			return badge(h, { intent: "info", size: "sm" }, ["Exporting"])
		case "ready":
			return badge(h, { intent: "success", size: "sm" }, ["Ready"])
		case "failed":
			return badge(h, { intent: "danger", size: "sm" }, ["Failed"])
	}
}

const detail = (row: Export, now: number): string => {
	switch (row.status) {
		case "pending":
			return "Waiting to start"
		case "running":
			return row.channelCount > 0
				? `${row.channelsDone} of ${row.channelCount} channels · ${row.rowCount.toLocaleString()} records`
				: `${row.rowCount.toLocaleString()} records`
		case "ready":
			return isExportExpired(row, now)
				? "No longer available"
				: `${row.rowCount.toLocaleString()} records · ${formatBytes(row.byteSize)}`
		case "failed":
			return row.error ?? "The export could not be completed"
	}
}

const exportRow = (h: HtmlBuilder<Message>, model: Model, row: Export, now: number): Html => {
	const percent = row.channelCount > 0 ? Math.round((row.channelsDone / row.channelCount) * 100) : 0
	const isDownloading = model.downloadingExportId === row.id
	return h.li(
		[h.Class("flex flex-col gap-2 py-3"), h.DataAttribute("export-id", row.id)],
		[
			h.div(
				[h.Class("flex items-center justify-between gap-3")],
				[
					h.div(
						[h.Class("flex min-w-0 flex-col gap-0.5")],
						[
							h.div(
								[h.Class("flex items-center gap-2")],
								[
									h.span(
										[h.Class("font-medium text-fg text-sm")],
										[dateFormat.format(new Date(toMillis(row.createdAt)))],
									),
									statusBadge(h, row, now),
								],
							),
							h.span([h.Class("truncate text-muted-fg text-xs")], [detail(row, now)]),
						],
					),
					...(row.status === "ready" && !isExportExpired(row, now)
						? [
								button(
									h,
									{
										intent: "outline",
										size: "sm",
										isDisabled: model.downloadingExportId !== null,
										isPending: isDownloading,
										onPress: Message.ClickedDownloadExport({ exportId: row.id }),
									},
									[
										IconDownload(h, { attributes: { "data-slot": "icon" } }),
										isDownloading ? "Preparing..." : "Download",
									],
								),
							]
						: []),
				],
			),
			...(row.status === "running"
				? [
						progressBar(h, { ariaLabel: "Export progress", value: percent }, [
							progressBarTrack(h, { value: percent }),
						]),
					]
				: []),
		],
	)
}

export const exportDataCard = (h: HtmlBuilder<Message>, model: Model, now: number): Html => {
	const isStarting = ExportStart.guards.Starting(model.exportStart)
	const hasActive = model.exports.some(isExportActive)
	return card(h, {}, [
		cardHeader(h, [
			h.div(
				[h.Class("flex flex-col gap-0.5")],
				[
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							IconDownload(h, { className: "size-5 text-muted-fg" }),
							heading(h, { variant: "section" }, ["Export data"]),
						],
					),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[
							"Download a copy of this workspace: members, channels, threads, messages, reactions, pins and file links, as NDJSON. Integration tokens and other secrets are never included.",
						],
					),
				],
			),
		]),
		cardBody(h, [
			h.div(
				[h.Class("flex flex-col gap-4")],
				[
					h.div(
						[h.Class("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")],
						[
							h.p(
								[h.Class("text-muted-fg text-sm")],
								[
									hasActive
										? "An export is being prepared. You can leave this page; it keeps going."
										: "Large workspaces can take a while. Exports can be downloaded for 7 days.",
								],
							),
							button(
								h,
								{
									intent: "secondary",
									size: "md",
									isDisabled: isStarting || hasActive,
									isPending: isStarting,
									onPress: Message.ClickedStartExport(),
								},
								[isStarting ? "Starting..." : "Export data"],
							),
						],
					),
					...(model.exports.length > 0
						? [
								h.ul(
									[h.Class("flex flex-col divide-y divide-border border-border border-t")],
									model.exports.slice(0, 5).map((row) => exportRow(h, model, row, now)),
								),
							]
						: []),
				],
			),
		]),
	])
}
