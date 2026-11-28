import type { PageFixture } from "../page-fixture"
import { seedIntegrations } from "./settings-integrations"

/** `/hazel/settings/integrations/your-apps`, its first bot's menu open. */
const fixture: PageFixture = { seed: seedIntegrations }

export default fixture
