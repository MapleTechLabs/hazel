import { MAYA as ME, NOW, ORGANIZATION_ID } from "../../lab/fixtures/customers"
import type { Shared } from "../contract"
import { sharedDefaults } from "../test-shared"

/** The `Shared` a customers page sees in the lab: the fixtures' org, signed in as `ME`, at `NOW`. */
export const labShared: Shared = {
	auth: "SignedIn",
	orgSlug: "lab",
	currentUser: {
		id: ME.id,
		firstName: ME.name.split(" ")[0] ?? ME.name,
		lastName: ME.name.split(" ").slice(1).join(" "),
		email: ME.email,
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: ORGANIZATION_ID, name: "Northwind", slug: "lab", logoUrl: null },
	member: null,
	nowMs: NOW.getTime(),
	...sharedDefaults,
}
