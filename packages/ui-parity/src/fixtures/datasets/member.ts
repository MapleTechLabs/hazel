import type { Dataset } from "../dataset.ts"
import { defaultDataset, defaultIds } from "./default.ts"
import { integrationsDataset } from "./integrations.ts"

/**
 * The rich workspace seen by Alan, a plain member (non-admin), so permission-gated
 * settings UI is hidden. Clerk and `user.me` both sign in as Alan.
 */
export const memberDataset: Dataset = {
	...integrationsDataset,
	name: "member",
	clerkOrgId: defaultDataset.clerkOrgId,
	currentUser: {
		...defaultDataset.currentUser,
		id: defaultIds.user("alan"),
		clerkUserId: "user_alan",
		role: "member",
		firstName: "Alan",
		lastName: "Turing",
		email: "alan@hazel.test",
	} as Dataset["currentUser"],
}

/** Alan in the plain default workspace (no custom emojis), for member empty states. */
export const memberEmptyDataset: Dataset = {
	...memberDataset,
	name: "member-empty",
	tables: defaultDataset.tables,
	rpc: {},
}
