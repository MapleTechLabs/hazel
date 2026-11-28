import type { PageFixture } from "../page-fixture"
import { adaUserId, generalChannelId, orgId } from "../snapshot"

/** A host the client knows (the fixture's own organization, so it has a name) and one it does not. */
const unknownHost = "00000001-0000-4000-8000-000000000009"

const invite = (n: number, host: string, status: string, createdAt: string) => ({
	id: `0000000f-0000-4000-8000-00000000000${n}`,
	conversationId: `00000010-0000-4000-8000-00000000000${n}`,
	hostOrganizationId: host,
	hostChannelId: generalChannelId,
	targetKind: "slug",
	targetValue: "hazel",
	guestOrganizationId: null,
	status,
	allowGuestMemberAdds: false,
	invitedBy: adaUserId,
	acceptedBy: null,
	acceptedAt: null,
	expiresAt: null,
	createdAt,
	updatedAt: null,
	deletedAt: null,
})

/** `/hazel/settings/connect-invites`: two pending invites over a declined one. */
const fixture: PageFixture = {
	rpcs: {
		"connectShare.invite.listIncoming": () => ({
			data: [
				invite(1, unknownHost, "declined", "2026-11-10T09:00:00.000Z"),
				invite(2, orgId, "pending", "2026-11-20T09:00:00.000Z"),
				invite(3, unknownHost, "pending", "2026-11-24T09:00:00.000Z"),
			],
		}),
	},
}

export default fixture
