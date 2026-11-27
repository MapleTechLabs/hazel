/** Re-exports `@hazel/shared-screens/customers/data/issues` at its old path, bound to the app's `clientData`. */
import { makeIssueData } from "@hazel/shared-screens/customers/data/issues"
import { clientData } from "~/db/client"

export * from "@hazel/shared-screens/customers/data/issues"

export const {
	issuesStream,
	accountIssuesStream,
	myWaitingIssueCountStream,
	issueAtMessageStream,
	updateIssueAction,
	createIssueFromMessageAction,
} = makeIssueData(clientData)
