/** Re-exports `@hazel/shared-screens/customers/data/sla` at its old path, bound to the app's `clientData`. */
import { makeSlaQueries } from "@hazel/shared-screens/customers/data/sla"
import { clientData } from "~/db/client"

export * from "@hazel/shared-screens/customers/data/sla"

export const { issueSlasStream, accountIssueSlasStream, issueSlaStream } = makeSlaQueries(clientData)
