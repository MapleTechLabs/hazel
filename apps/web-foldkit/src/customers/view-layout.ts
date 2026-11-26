/** Re-exports `@hazel/shared-screens/customers/data/view-layout` at its old path, bound to the app's `clientData`. */
import { makeViewLayoutActions } from "@hazel/shared-screens/customers/data/view-layout"
import { clientData } from "~/db/client"

export * from "@hazel/shared-screens/customers/data/view-layout"

export const { saveLayoutAction } = makeViewLayoutActions(clientData)
