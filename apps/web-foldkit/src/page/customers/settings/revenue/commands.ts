import * as Customers from "@hazel/domain/customers"
import { CustomerSettingsId, OrganizationId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { Duration, Effect, Schema } from "effect"
import { Command } from "foldkit"
import { customerSettingsCollection } from "~/db/collections"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import { Message } from "./message"

/** The revenue settings' Commands: the catalog, the debounced preview, saving. */

/** How long the draft must stay still before it is previewed. */
export const PREVIEW_DELAY = Duration.millis(500)

export const FetchRevenueCatalog = Command.define("FetchRevenueCatalog", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededFetchRevenueCatalog, Message.FailedFetchRevenueCatalog],
	execute: ({ organizationId }) =>
		HazelRpc.use((rpc) => rpc("customers.revenue.catalog", { organizationId })).pipe(
			Effect.map((catalog) => Message.SucceededFetchRevenueCatalog({ catalog })),
			catchCommon((reason) => Message.FailedFetchRevenueCatalog({ reason })),
		),
})

export const DelayRevenuePreview = Command.define("DelayRevenuePreview", {
	args: { version: Schema.Int },
	messages: [Message.ElapsedRevenuePreviewDelay],
	execute: ({ version }) =>
		Effect.sleep(PREVIEW_DELAY).pipe(Effect.as(Message.ElapsedRevenuePreviewDelay({ version }))),
})

export const FetchRevenuePreview = Command.define("FetchRevenuePreview", {
	args: {
		organizationId: OrganizationId,
		rules: Customers.RevenueRules,
		variableMrrMonths: Customers.VariableMrrMonths,
		version: Schema.Int,
	},
	messages: [Message.SucceededFetchRevenuePreview, Message.FailedFetchRevenuePreview],
	execute: ({ organizationId, rules, variableMrrMonths, version }) =>
		HazelRpc.use((rpc) =>
			rpc("customers.revenue.preview", { organizationId, rules, variableMrrMonths }),
		).pipe(
			Effect.map((result) => Message.SucceededFetchRevenuePreview({ version, result })),
			catchCommon((reason) => Message.FailedFetchRevenuePreview({ version, reason })),
		),
})

interface SaveProps {
	readonly organizationId: OrganizationId
	readonly settingsId: CustomerSettingsId
	readonly rules: ReadonlyArray<Customers.RevenueRule>
	readonly variableMrrMonths: number
}

/** The settings row takes the rules at once; the next compute restates the history under them. */
const saveRevenueSettingsAction = optimisticAction({
	collections: [customerSettingsCollection],
	onMutate: (props: SaveProps) => {
		customerSettingsCollection.update(props.settingsId, (row) => {
			Object.assign(row, {
				revenueRules: props.rules,
				variableMrrMonths: props.variableMrrMonths,
			})
		})
		return { settingsId: props.settingsId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.settings.update", {
				organizationId: props.organizationId,
				revenueRules: props.rules,
				variableMrrMonths: props.variableMrrMonths,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const SaveRevenueSettings = Command.define("SaveRevenueSettings", {
	args: {
		organizationId: OrganizationId,
		settingsId: CustomerSettingsId,
		rules: Customers.RevenueRules,
		variableMrrMonths: Customers.VariableMrrMonths,
	},
	messages: [Message.SucceededSaveRevenueSettings, Message.FailedSaveRevenueSettings],
	execute: (args) =>
		saveRevenueSettingsAction(args).pipe(
			Effect.as(Message.SucceededSaveRevenueSettings()),
			catchCommon((reason) => Message.FailedSaveRevenueSettings({ reason })),
		),
})
