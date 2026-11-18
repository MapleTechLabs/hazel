import { CustomerSettingsId, OrganizationId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { Effect } from "effect"
import { Command } from "foldkit"
import { customerSettingsCollection } from "~/db/collections"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import { Message } from "./message"
import { SettingsChange } from "./model"

/** The plans page's Commands: the plan names, and saving the settings (add-ons, overage in MRR). */

export const FetchPlans = Command.define("FetchPlans", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededFetchPlans, Message.FailedFetchPlans],
	execute: ({ organizationId }) =>
		HazelRpc.use((rpc) => rpc("customers.plans.list", { organizationId })).pipe(
			Effect.map(({ plans }) => Message.SucceededFetchPlans({ plans })),
			catchCommon((reason) => Message.FailedFetchPlans({ reason })),
		),
})

interface SaveProps {
	readonly organizationId: OrganizationId
	readonly settingsId: CustomerSettingsId
	readonly change: SettingsChange
}

/** The settings row takes the change at once; the server recomputes the accounts soon. */
const saveSettingsAction = optimisticAction({
	collections: [customerSettingsCollection],
	onMutate: (props: SaveProps) => {
		customerSettingsCollection.update(props.settingsId, (row) => {
			Object.assign(row, props.change)
		})
		return { settingsId: props.settingsId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.settings.update", {
				organizationId: props.organizationId,
				...props.change,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const SaveSettings = Command.define("SaveSettings", {
	args: { organizationId: OrganizationId, settingsId: CustomerSettingsId, change: SettingsChange },
	messages: [Message.SucceededSaveSettings, Message.FailedSaveSettings],
	execute: (args) =>
		saveSettingsAction(args).pipe(
			Effect.as(Message.SucceededSaveSettings()),
			catchCommon((reason) => Message.FailedSaveSettings({ reason })),
		),
})
