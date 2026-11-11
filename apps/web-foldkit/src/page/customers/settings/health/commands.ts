import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSettingsId, OrganizationId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { Duration, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { customerSettingsCollection } from "~/db/collections"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import { Message } from "./message"

/** The health settings page's Commands: the debounced dry run, one account's breakdown, saving. */

/** How long the draft must stay still before it is scored. */
export const PREVIEW_DELAY = Duration.millis(400)

export const DelayHealthPreview = Command.define("DelayHealthPreview", {
	args: { version: Schema.Int },
	messages: [Message.ElapsedHealthPreviewDelay],
	execute: ({ version }) =>
		Effect.sleep(PREVIEW_DELAY).pipe(Effect.as(Message.ElapsedHealthPreviewDelay({ version }))),
})

export const FetchHealthDryRun = Command.define("FetchHealthDryRun", {
	args: { organizationId: OrganizationId, draft: Customers.HealthSettings, version: Schema.Int },
	messages: [Message.SucceededFetchHealthDryRun, Message.FailedFetchHealthDryRun],
	execute: ({ organizationId, draft, version }) =>
		HazelRpc.use((rpc) => rpc("customers.health.dryRun", { organizationId, draft })).pipe(
			Effect.map((result) => Message.SucceededFetchHealthDryRun({ version, result })),
			catchCommon((reason) => Message.FailedFetchHealthDryRun({ version, reason })),
		),
})

/** The account's saved breakdown, from its detail. */
export const FetchHealthCheckDetail = Command.define("FetchHealthCheckDetail", {
	args: { organizationId: OrganizationId, accountId: CustomerAccountId },
	messages: [Message.SucceededFetchHealthCheckDetail, Message.FailedFetchHealthCheckDetail],
	execute: ({ organizationId, accountId }) =>
		HazelRpc.use((rpc) => rpc("customers.account.detail", { organizationId, accountId })).pipe(
			Effect.map((detail) =>
				Message.SucceededFetchHealthCheckDetail({ accountId, health: detail.health }),
			),
			// Deleted since it synced: reads like any other failure, the panel offers nothing more.
			Effect.catchTag("CustomersNotFoundError", () =>
				Effect.succeed(Message.FailedFetchHealthCheckDetail({ accountId, reason: "Unexpected" })),
			),
			catchCommon((reason) => Message.FailedFetchHealthCheckDetail({ accountId, reason })),
		),
})

interface SaveProps {
	readonly organizationId: OrganizationId
	readonly settingsId: CustomerSettingsId
	readonly health: Customers.HealthSettings
}

/** The collection row's mutable copy (its arrays are not readonly). */
const writable = (health: Customers.HealthSettings) => ({
	...health,
	steps: {
		...health.steps,
		usage: {
			...health.steps.usage,
			activeRatio: [...health.steps.usage.activeRatio],
			trend: [...health.steps.usage.trend],
		},
		engagement: { daysSinceActive: [...health.steps.engagement.daysSinceActive] },
	},
	excludedTemplates: [...health.excludedTemplates],
})

/** The settings row takes the draft at once; the server rescores on its next compute. */
const saveHealthSettingsAction = optimisticAction({
	collections: [customerSettingsCollection],
	onMutate: (props: SaveProps) => {
		customerSettingsCollection.update(props.settingsId, (row) => {
			row.health = writable(props.health)
		})
		return { settingsId: props.settingsId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.settings.update", {
				organizationId: props.organizationId,
				health: props.health,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const SaveHealthSettings = Command.define("SaveHealthSettings", {
	args: {
		organizationId: OrganizationId,
		settingsId: CustomerSettingsId,
		health: Customers.HealthSettings,
	},
	messages: [Message.SucceededSaveHealthSettings, Message.FailedSaveHealthSettings],
	execute: (args) =>
		saveHealthSettingsAction(args).pipe(
			Effect.as(Message.SucceededSaveHealthSettings()),
			catchCommon((reason) => Message.FailedSaveHealthSettings({ reason })),
		),
})
