/** Re-exports `@hazel/shared-screens/customers/data/actions` at its old path, bound to the app's `clientData`. */
import { makeCustomerActions } from "@hazel/shared-screens/customers/data/actions"
import { clientData } from "~/db/client"

export * from "@hazel/shared-screens/customers/data/actions"

export const {
	assignSignalAction,
	snoozeSignalAction,
	markSignalDoneAction,
	reopenSignalAction,
	createNoteAction,
	updateNoteAction,
	deleteNoteAction,
	updateAccountAction,
	addDomainAction,
	setAttentionMuteAction,
	bulkUpdateAccountsAction,
	linkAccountAction,
	unlinkAccountAction,
	setPrimaryAccountAction,
	setEnvironmentAction,
	grantImpersonatorAction,
	revokeImpersonatorAction,
	setFeatureFlagsAction,
	createFeatureFlagAction,
	deleteFeatureFlagAction,
} = makeCustomerActions(clientData)
