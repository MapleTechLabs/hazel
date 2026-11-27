import type { PageFixture } from "../page-fixture"
import { seedSignals } from "./customers-signals"

/** A saved rule's editor (`/hazel/customers/settings/signals/<Payment failed>`), over the list's rules. */
const fixture: PageFixture = { seed: seedSignals }

export default fixture
