import type { PageFixture } from "../page-fixture"
import { seedIntegrations } from "./settings-integrations"

/** `/hazel/settings/integrations/installed`, its first uninstall asking to confirm. */
const fixture: PageFixture = { seed: seedIntegrations }

export default fixture
