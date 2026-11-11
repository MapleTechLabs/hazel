import { CustomerSettingsId, OrganizationId } from "@hazel/schema"
import { optimisticAction } from "@hazel/effect-db-collection"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { customerSettingsCollection } from "~/db/collections"
import { catchCommon } from "../../../../data/actions"
import { HazelRpc } from "../../../../rpc"
import { Message } from "./message"

/** The plans page's Commands: the plan names, and saving the add-on list. */

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
	readonly addOnPlans: ReadonlyArray<string>
}

/** The settings row takes the list at once; the server recomputes the accounts' plans soon. */
const saveAddOnPlansAction = optimisticAction({
	collections: [customerSettingsCollection],
	onMutate: (props: SaveProps) => {
		customerSettingsCollection.update(props.settingsId, (row) => {
			row.addOnPlans = [...props.addOnPlans]
		})
		return { settingsId: props.settingsId }
	},
	mutate: (props) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const result = yield* client("customers.settings.update", {
				organizationId: props.organizationId,
				addOnPlans: props.addOnPlans,
			})
			return { data: result, transactionId: result.transactionId }
		}),
})

export const SaveAddOnPlans = Command.define("SaveAddOnPlans", {
	args: {
		organizationId: OrganizationId,
		settingsId: CustomerSettingsId,
		addOnPlans: Schema.Array(Schema.String),
	},
	messages: [Message.SucceededSaveAddOnPlans, Message.FailedSaveAddOnPlans],
	execute: (args) =>
		saveAddOnPlansAction(args).pipe(
			Effect.as(Message.SucceededSaveAddOnPlans()),
			catchCommon((reason) => Message.FailedSaveAddOnPlans({ reason })),
		),
})
