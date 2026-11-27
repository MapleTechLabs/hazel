// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The general settings' "Export data" card (owners and admins), and its live query. */
import type { ClientData } from "@hazel/client-data"
import type { OrganizationExport } from "@hazel/domain/models"
import type { OrganizationId } from "@hazel/schema"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { BadgeTone } from "@hazel/ui/vocabulary/options"
import { eq } from "@tanstack/db"
import { DateTime, Match, type Stream } from "effect"
import { withData } from "../../../app/live"
import { cardBody, settingsCard } from "../../shared/card"
import { type ExportRow, GeneralMessage, type GeneralModel } from "./model"

const toMillis = (value: Date | DateTime.Utc): number =>
	value instanceof Date ? value.getTime() : DateTime.toEpochMillis(value)

/** The organization's ten newest exports. */
export const exportsStream = <M>(
	organizationId: OrganizationId,
	to: (exports: ReadonlyArray<ExportRow>) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<OrganizationExport.Type, M>(
			(q) =>
				q
					.from({ exp: data.collections.organizationExportCollection })
					.where(({ exp }) => eq(exp.organizationId, organizationId))
					.orderBy(({ exp }) => exp.createdAt, "desc"),
			(rows) =>
				to(
					rows.slice(0, 10).map((row) => ({
						id: row.id,
						status: row.status,
						createdAtMs: toMillis(row.createdAt),
						expiresAtMs: row.expiresAt === null ? null : toMillis(row.expiresAt),
						channelCount: row.channelCount,
						channelsDone: row.channelsDone,
						rowCount: row.rowCount,
						byteSize: row.byteSize,
						error: row.error,
					})),
				),
		),
	)

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

export const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export const isExportActive = (row: ExportRow) => row.status === "pending" || row.status === "running"

export const isExportExpired = (row: ExportRow, now: number) =>
	row.expiresAtMs !== null && row.expiresAtMs <= now

const statusOf = (row: ExportRow, now: number): { readonly label: string; readonly tone: BadgeTone } =>
	row.status === "ready" && isExportExpired(row, now)
		? { label: "Expired", tone: "neutral" }
		: Match.value(row.status).pipe(
				Match.when("pending", () => ({ label: "Queued", tone: "neutral" as const })),
				Match.when("running", () => ({ label: "Exporting", tone: "info" as const })),
				Match.when("ready", () => ({ label: "Ready", tone: "success" as const })),
				Match.when("failed", () => ({ label: "Failed", tone: "danger" as const })),
				Match.exhaustive,
			)

export const exportDetail = (row: ExportRow, now: number): string =>
	Match.value(row.status).pipe(
		Match.when("pending", () => "Waiting to start"),
		Match.when("running", () =>
			row.channelCount > 0
				? `${row.channelsDone} of ${row.channelCount} channels · ${row.rowCount.toLocaleString()} records`
				: `${row.rowCount.toLocaleString()} records`,
		),
		Match.when("ready", () =>
			isExportExpired(row, now)
				? "No longer available"
				: `${row.rowCount.toLocaleString()} records · ${formatBytes(row.byteSize)}`,
		),
		Match.when("failed", () => row.error ?? "The export could not be completed"),
		Match.exhaustive,
	)

type H = Hazel.H<GeneralMessage>

const exportRow = (h: H, model: GeneralModel, row: ExportRow, now: number) => {
	const status = statusOf(row, now)
	const isDownloading = model.downloadingExportId === row.id
	const fraction = row.channelCount > 0 ? row.channelsDone / row.channelCount : 0
	return h.stack
		.key(row.id)
		.density("compact")
		.children(
			h.stack
				.axis("horizontal")
				.align("center")
				.density("cozy")
				.children(
					h.stack.density("tight").children(
						h.stack
							.axis("horizontal")
							.align("center")
							.density("compact")
							.children(
								h.text
									.role("label")
									.strong()
									.children(dateFormat.format(new Date(row.createdAtMs))),
								h.badge.label(status.label).tone(status.tone).size("small"),
							),
						h.text.role("caption").tone("muted").truncate().children(exportDetail(row, now)),
					),
					h.spacer,
					row.status === "ready" && !isExportExpired(row, now)
						? h.button
								.label(isDownloading ? "Preparing..." : "Download")
								.icon("download")
								.variant("outline")
								.size("small")
								.loading(isDownloading)
								.disabled(model.downloadingExportId !== null)
								.on("press", GeneralMessage.PressedDownload({ exportId: row.id }))
						: null,
				),
			row.status === "running" ? h.progress.label("Export progress").value(fraction) : null,
		)
}

export const exportCard = (h: H, model: GeneralModel, now: number) => {
	const hasActive = model.exports.some(isExportActive)
	const rows = model.exports.slice(0, 5)
	return settingsCard(
		h,
		"general:export",
		{
			icon: "download",
			inline: true,
			title: "Export data",
			subtitle:
				"Download a copy of this workspace: members, channels, threads, messages, reactions, pins and file links, as NDJSON. Integration tokens and other secrets are never included.",
		},
		cardBody(
			h,
			// HAZEL-GAP(p4-wrap-on-compact): today this row stacks its note over the button below `sm`.
			h.stack
				.axis("horizontal")
				.align("center")
				.density("cozy")
				.children(
					h.text
						.role("label")
						.tone("muted")
						.children(
							hasActive
								? "An export is being prepared. You can leave this page; it keeps going."
								: "Large workspaces can take a while. Exports can be downloaded for 7 days.",
						),
					h.spacer,
					h.button
						.label(model.startingExport ? "Starting..." : "Export data")
						.variant("secondary")
						.loading(model.startingExport)
						.disabled(model.startingExport || hasActive)
						.on("press", GeneralMessage.PressedStartExport()),
				),
			// HAZEL-GAP(p4-divided-rows): today's rows are `py-3` between hairlines under a top rule.
			rows.length === 0
				? null
				: h.stack
						.key("general:exports")
						.density("cozy")
						.children(
							...rows.flatMap((row) => [
								h.divider.key(`rule:${row.id}`),
								exportRow(h, model, row, now),
							]),
						),
		),
	)
}
