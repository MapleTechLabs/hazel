import { PLANS, seedCustomers, settingsRow } from "../customers-settings-seed"
import type { PageFixture } from "../page-fixture"

/** Plans: four plans on the org's subscriptions, one marked an add-on. */
const fixture: PageFixture = {
	seed: (server) => seedCustomers(server, { customer_settings: [settingsRow(["Seats add-on"])] }),
	rpcs: { "customers.plans.list": () => ({ plans: PLANS }) },
}

export default fixture
