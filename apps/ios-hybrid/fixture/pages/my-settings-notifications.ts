import type { PageFixture } from "../page-fixture"
import { adaUserId, channelMemberRows, designChannelId, orgId } from "../snapshot"

/** Notifications: Ada set #design to all messages and muted it, so the overrides list has a row. */
const fixture: PageFixture = {
	seed: (server) =>
		server.write(
			"org",
			orgId,
			"channel_members",
			channelMemberRows
				.filter((row) => row.userId === adaUserId && row.channelId === designChannelId)
				.map((row) => ({ ...row, notificationLevel: "all", isMuted: true })),
		),
}

export default fixture
