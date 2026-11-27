import { ACCOUNTS, PLANS, POLICIES, seedCustomers, settingsRow } from "../customers-settings-seed"
import type { PageFixture } from "../page-fixture"

/** Support SLAs: Berlin business hours, three policies (one off), triage on. */
const fixture: PageFixture = {
	seed: (server) =>
		seedCustomers(server, {
			customer_settings: [settingsRow([])],
			customer_sla_policies: POLICIES,
			customer_accounts: ACCOUNTS,
		}),
	rpcs: { "customers.plans.list": () => ({ plans: PLANS }) },
}

export default fixture
