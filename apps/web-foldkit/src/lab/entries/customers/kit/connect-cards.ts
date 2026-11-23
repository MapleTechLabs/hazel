import { connectCard } from "../../../../customers/ui/connect-card"
import { defineStaticLab, ignored } from "../../../define"
import { labPage, labSection } from "../../../frame"
import { DIRECTORY_CONNECTION, ACTIVITY_ERROR_AT, NOW, INVOICES_PROGRESS } from "../../../fixtures/customers"
import { ACTIVITY, DIRECTORY, INVOICES, PLANS } from "../../../fixtures/customers-demo-sources"

// `/lab/customers/kit/connect-cards`: Foundations › Integration Connect Cards.

export const lab = defineStaticLab("Connect cards", (h) =>
	labPage(h, { title: "Data source cards" }, [
		labSection(
			h,
			"Connected · syncing · not connected · error",
			[
				connectCard(h, {
					provider: DIRECTORY.id,
					now: NOW,
					status: {
						_tag: "Connected",
						syncedAt: DIRECTORY_CONNECTION.lastSyncAt,
						summary: "214 organizations · 1,862 users",
						onSyncNow: ignored,
					},
				}),
				connectCard(h, {
					provider: INVOICES.id,
					now: NOW,
					status: {
						_tag: "Syncing",
						step: INVOICES_PROGRESS.step,
						done: INVOICES_PROGRESS.done,
						total: INVOICES_PROGRESS.total,
						onCancel: ignored,
					},
				}),
				connectCard(h, {
					provider: PLANS.id,
					now: NOW,
					status: { _tag: "NotConnected", onConnect: ignored },
				}),
				connectCard(h, {
					provider: ACTIVITY.id,
					now: NOW,
					status: {
						_tag: "Error",
						at: ACTIVITY_ERROR_AT,
						message: "API key was revoked. Last good sync Nov 9, 18:42.",
						action: { label: "Update API key", onPress: ignored },
					},
				}),
			],
			"grid gap-4 md:grid-cols-2",
		),
		labSection(
			h,
			"Syncing, total unknown",
			[
				connectCard(h, {
					provider: INVOICES.id,
					now: NOW,
					status: { _tag: "Syncing", step: "customers", done: 412, total: null },
				}),
			],
			"max-w-xl",
		),
	]),
)
