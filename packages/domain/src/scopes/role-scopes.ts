import type { ApiScope } from "./api-scope"

/** Owner: full access to everything */
const OWNER_SCOPES: ReadonlySet<ApiScope> = new Set<ApiScope>([
	"organizations:read",
	"organizations:write",
	"channels:read",
	"channels:write",
	"messages:read",
	"messages:write",
	"channel-members:read",
	"channel-members:write",
	"organization-members:read",
	"organization-members:write",
	"bots:read",
	"bots:write",
	"attachments:read",
	"attachments:write",
	"channel-sections:read",
	"channel-sections:write",
	"channel-webhooks:read",
	"channel-webhooks:write",
	"custom-emojis:read",
	"custom-emojis:write",
	"customers:read",
	"customers:write",
	"github-subscriptions:read",
	"github-subscriptions:write",
	"integration-connections:read",
	"integration-connections:write",
	"message-reactions:read",
	"message-reactions:write",
	"notifications:read",
	"notifications:write",
	"pinned-messages:read",
	"pinned-messages:write",
	"rss-subscriptions:read",
	"rss-subscriptions:write",
	"typing-indicators:read",
	"typing-indicators:write",
	"user-presence-status:read",
	"user-presence-status:write",
	"users:read",
	"users:write",
])

/** Admin: same as owner (for now) */
const ADMIN_SCOPES: ReadonlySet<ApiScope> = new Set<ApiScope>([
	"organizations:read",
	"organizations:write",
	"channels:read",
	"channels:write",
	"messages:read",
	"messages:write",
	"channel-members:read",
	"channel-members:write",
	"organization-members:read",
	"organization-members:write",
	"bots:read",
	"bots:write",
	"attachments:read",
	"attachments:write",
	"channel-sections:read",
	"channel-sections:write",
	"channel-webhooks:read",
	"channel-webhooks:write",
	"custom-emojis:read",
	"custom-emojis:write",
	"customers:read",
	"customers:write",
	"github-subscriptions:read",
	"github-subscriptions:write",
	"integration-connections:read",
	"integration-connections:write",
	"message-reactions:read",
	"message-reactions:write",
	"notifications:read",
	"notifications:write",
	"pinned-messages:read",
	"pinned-messages:write",
	"rss-subscriptions:read",
	"rss-subscriptions:write",
	"typing-indicators:read",
	"typing-indicators:write",
	"user-presence-status:read",
	"user-presence-status:write",
	"users:read",
	"users:write",
])

/** Member: restricted write access — no channel, org, bot, webhook, or integration management */
const MEMBER_SCOPES: ReadonlySet<ApiScope> = new Set<ApiScope>([
	"organizations:read",
	"channels:read",
	"messages:read",
	"messages:write",
	"channel-members:read",
	"channel-members:write",
	"organization-members:read",
	"bots:read",
	"attachments:read",
	"attachments:write",
	"channel-sections:read",
	"channel-sections:write",
	"channel-webhooks:read",
	"custom-emojis:read",
	// Queue work (assign, snooze, notes); settings are checked for admins in the handlers.
	"customers:read",
	"customers:write",
	"github-subscriptions:read",
	"integration-connections:read",
	"message-reactions:read",
	"message-reactions:write",
	"notifications:read",
	"notifications:write",
	"pinned-messages:read",
	"pinned-messages:write",
	"rss-subscriptions:read",
	"typing-indicators:read",
	"typing-indicators:write",
	"user-presence-status:read",
	"user-presence-status:write",
	"users:read",
])

/**
 * Maps an organization role to its granted API scopes.
 */
export const scopesForRole = (role: "owner" | "admin" | "member"): ReadonlySet<ApiScope> => {
	switch (role) {
		case "owner":
			return OWNER_SCOPES
		case "admin":
			return ADMIN_SCOPES
		case "member":
			return MEMBER_SCOPES
	}
}
