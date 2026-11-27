import { customersRpcs, seedCustomers } from "../customers-seed"
import type { PageFixture } from "../page-fixture"

/** `/hazel/customers/support`: the lab's 30-day support report over its accounts. */
const fixture: PageFixture = { seed: seedCustomers, rpcs: customersRpcs }

export default fixture
