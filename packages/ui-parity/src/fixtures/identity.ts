import type { ClerkStubIdentity } from "../runtime/clerk-stub.ts"
import type { Dataset } from "./dataset.ts"

/**
 * The Clerk identity a dataset signs in as. Captures inject it per scenario, `serve` per server.
 * Signed-out datasets get `null`: the stub then has no session, user or organization.
 */
export const clerkIdentityFor = (dataset: Dataset): ClerkStubIdentity | null =>
	dataset.signedOut
		? null
		: {
				clerkUserId: dataset.currentUser.clerkUserId,
				email: dataset.currentUser.email,
				firstName: dataset.currentUser.firstName ?? "",
				lastName: dataset.currentUser.lastName ?? "",
				imageUrl: "",
				clerkOrgId: dataset.clerkOrgId,
			}
