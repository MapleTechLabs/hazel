import type { PageFixture } from "../page-fixture"
import { adaUserId, orgId } from "../snapshot"

const invitation = (n: number, email: string, role: "admin" | "member", sent: string) => ({
	id: `00000000-0000-4000-8000-00000001${String(n).padStart(4, "0")}`,
	organizationId: orgId,
	email,
	role,
	invitedBy: adaUserId,
	createdAt: sent,
	expiresAt: "2026-12-30T12:00:00.000Z",
})

/** `/hazel/settings/invitations`: three pending invitations, newest first. */
const fixture: PageFixture = {
	rpcs: {
		"invitation.list": () => [
			invitation(1, "linus@hazel.test", "member", "2026-11-25T12:00:00.000Z"),
			invitation(2, "barbara.liskov@hazel.test", "admin", "2026-11-23T12:00:00.000Z"),
			invitation(3, "ken@hazel.test", "member", "2026-11-20T12:00:00.000Z"),
		],
	},
}

export default fixture
