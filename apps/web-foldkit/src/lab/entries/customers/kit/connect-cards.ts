import { connectCard } from "../../../../customers/ui/connect-card"
import { defineStaticLab, ignored } from "../../../define"
import { labPage, labSection } from "../../../frame"
import { CLERK_CONNECTION, MAPLE_ERROR_AT, NOW, STRIPE_PROGRESS } from "../../../fixtures/customers"

// `/lab/customers/kit/connect-cards`: Foundations › Integration Connect Cards.

export const lab = defineStaticLab("Connect cards", (h) =>
	labPage(h, { title: "Data source cards" }, [
		labSection(
			h,
			"Connected · syncing · not connected · error",
			[
				connectCard(h, {
					provider: "clerk",
					now: NOW,
					status: {
						_tag: "Connected",
						syncedAt: CLERK_CONNECTION.lastSyncAt,
						summary: "214 organizations · 1,862 users",
						onSyncNow: ignored,
					},
				}),
				connectCard(h, {
					provider: "stripe",
					now: NOW,
					status: {
						_tag: "Syncing",
						step: STRIPE_PROGRESS.step,
						done: STRIPE_PROGRESS.done,
						total: STRIPE_PROGRESS.total,
						onCancel: ignored,
					},
				}),
				connectCard(h, {
					provider: "autumn",
					now: NOW,
					status: { _tag: "NotConnected", onConnect: ignored },
				}),
				connectCard(h, {
					provider: "maple",
					now: NOW,
					status: {
						_tag: "Error",
						at: MAPLE_ERROR_AT,
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
					provider: "stripe",
					now: NOW,
					status: { _tag: "Syncing", step: "customers", done: 412, total: null },
				}),
			],
			"max-w-xl",
		),
	]),
)
