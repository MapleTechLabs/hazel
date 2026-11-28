import { Schema } from "effect"
import * as CurrentUser from "../../../../packages/domain/src/current-user"
import { currentUser } from "../offline-session"
import { adaUserId, userRows } from "../snapshot"
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
		// The profile and time zone steps save through `user.update`: Ada's row with the change.
		"user.update": (payload) => ({
			data: { ...userRows.find((row) => row.id === adaUserId), ...payload },
			transactionId: "00000000-0000-4000-8000-0000000000ac",
		}),
	},
}

export default notOnboarded
