import type { PageFixture } from "../page-fixture"
import { seedChannelFiles } from "./chat-files"

/** `/hazel/chat/<general>/files/media`: the same files as the Files tab. */
const fixture: PageFixture = { seed: seedChannelFiles }

export default fixture
