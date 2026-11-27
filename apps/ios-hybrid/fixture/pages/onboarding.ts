import { Schema } from "effect"
import * as CurrentUser from "../../../../packages/domain/src/current-user"
import { currentUser } from "../offline-session"
import type { PageFixture } from "../page-fixture"

/**
 * `/onboarding` on its welcome step: Ada has not finished onboarding. She is a member of the
 * fixture org (it has a slug), so she gets the invited flow ("Welcome to Hazel Labs!", 5 steps).
 */
const encode = Schema.encodeSync(Schema.toCodecJson(CurrentUser.Schema))

/** Shared with `onboarding-profile.ts`: her `user.me`, not onboarded yet. */
export const notOnboarded: PageFixture = {
	rpcs: {
		"user.me": () => encode(new CurrentUser.Schema({ ...currentUser, isOnboarded: false })),
	},
}

export default notOnboarded
