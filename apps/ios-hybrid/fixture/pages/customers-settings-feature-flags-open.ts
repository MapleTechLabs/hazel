import { ACCOUNTS, FEATURE_FLAGS, seedCustomers } from "../customers-settings-seed"
import type { PageFixture } from "../page-fixture"

/** Feature flags: three keys on the customers' records and one created in Hazel. */
const fixture: PageFixture = {
	seed: (server) =>
		seedCustomers(server, { customer_accounts: ACCOUNTS, customer_feature_flags: FEATURE_FLAGS }),
}

export default fixture
