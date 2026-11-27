import { seedDeployBot } from "../bot-seed"
import type { PageFixture } from "../page-fixture"

/** Ada's Deploy Bot on the your-apps page, so its menu opens the bot modals. */
const page: PageFixture = { seed: seedDeployBot }

export default page
