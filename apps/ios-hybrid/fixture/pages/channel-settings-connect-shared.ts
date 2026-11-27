import type { PageFixture } from "../page-fixture"
import { adaUserId, orgId } from "../snapshot"

/**
 * Connect for #general, shared with Acme Corp (its own channel mounted as guest) and two outgoing
 * invitations: one pending (Revoke), one declined.
 */
const generalId = "00000005-0000-4000-8000-000000000001"
const conversationId = "00000020-0000-4000-8000-000000000001"
const acmeOrgId = "00000001-0000-4000-8000-000000000002"
const createdAt = "2026-11-02T10:00:00.000Z"

const mount = (n: number, organizationId: string, channelId: string, role: "host" | "guest") => ({
	id: `00000021-0000-4000-8000-00000000000${n}`,
	conversationId,
	organizationId,
	channelId,
	role,
	allowGuestMemberAdds: false,
	isActive: true,
	createdAt,
	updatedAt: null,
	deletedAt: null,
})

const invite = (n: number, targetValue: string, status: string) => ({
	id: `00000022-0000-4000-8000-00000000000${n}`,
	conversationId,
	hostOrganizationId: orgId,
	hostChannelId: generalId,
	targetKind: "slug",
	targetValue,
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

const fixture: PageFixture = {
	seed: (server) => {
		server.write("org", orgId, "organizations", [
			{
				id: acmeOrgId,
				name: "Acme Corp",
				slug: "acme",
				logoUrl: null,
				settings: null,
				isPublic: true,
				readStateSince: null,
				createdAt,
				updatedAt: null,
				deletedAt: null,
			},
		])
		server.write("org", orgId, "connect_conversation_channels", [
			mount(1, orgId, generalId, "host"),
			mount(2, acmeOrgId, "00000005-0000-4000-8000-0000000000a1", "guest"),
		])
	},
	rpcs: {
		"connectShare.invite.listOutgoing": () => ({
			data: [invite(1, "globex", "pending"), invite(2, "initech", "declined")],
		}),
	},
}

export default fixture
