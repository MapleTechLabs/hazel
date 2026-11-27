import { customersRpcs, seedCustomers } from "../customers-seed"
import type { PageFixture } from "../page-fixture"

/** `/hazel/customers`: the lab org's accounts, signals and sources, its overview and support report. */
const fixture: PageFixture = { seed: seedCustomers, rpcs: customersRpcs }

export default fixture
