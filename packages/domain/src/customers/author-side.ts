/**
 * Who wrote a message in a channel linked to a customer: the customer, our team, a bot, or unknown
 * (`docs/customers/author-side.md`). A pure decision over facts the `OrgObject` knows about the
 * author (`AuthorFacts`) and a member's manual override. It applies to linked channels only.
 */
import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"

export const AuthorSide = Schema.Literals(["customer", "team", "bot", "unknown"])
export type AuthorSide = typeof AuthorSide.Type

/** What a member can set by hand on a person ("this person is on our team / is the customer"). */
export const AuthorSideOverride = Schema.Literals(["customer", "team"])
export type AuthorSideOverride = typeof AuthorSideOverride.Type

/** The rule that decided the side, so every answer can say why. */
export const AuthorSideReason = Schema.Literals([
	/** A member set it by hand. */
	"override",
	/** A member of the org (a linked Slack or Discord account counts: chat sync writes as them). */
	"org_member",
	/** Was a member of the org when they wrote. */
	"former_member",
	/** A member of another org in a Hazel Connect channel. */
	"connect_guest",
	/** A Slack author from another workspace (Slack Connect), account not linked. */
	"external_other_workspace",
	/** A Slack author from our own Slack workspace whose Hazel account is not linked. */
	"external_home_workspace",
	/** A Slack or Discord author whose workspace is not known (every Discord author). */
	"external",
	/** A bot, an integration, a webhook or Hazel itself. */
	"bot",
	/** Nothing says who they are. */
	"unknown",
])
export type AuthorSideReason = typeof AuthorSideReason.Type

/** Where a Slack author's workspace stands against the one the org connected. */
export const ExternalWorkspace = Schema.Literals(["home", "other"])
export type ExternalWorkspace = typeof ExternalWorkspace.Type

/** What the org knows about an author, before any override. */
export const AuthorFacts = Schema.Union([
	Schema.TaggedStruct("Member", {}),
	Schema.TaggedStruct("FormerMember", {}),
	Schema.TaggedStruct("ConnectGuest", { homeOrganizationId: OrganizationId }),
	Schema.TaggedStruct("External", {
		/** The chat-sync provider (`slack`, `discord`). */
		provider: Schema.String,
		/** `null`: the provider did not say (Discord always). */
		workspace: Schema.NullOr(ExternalWorkspace),
	}),
	Schema.TaggedStruct("Bot", {}),
	Schema.TaggedStruct("Unknown", {}),
])
export type AuthorFacts = typeof AuthorFacts.Type

export interface AuthorClassification {
	readonly side: AuthorSide
	readonly reason: AuthorSideReason
}

const decided = (side: AuthorSide, reason: AuthorSideReason): AuthorClassification => ({ side, reason })

/**
 * The side of an author in a linked channel. A bot stays a bot whatever the override; otherwise an
 * override wins. Without one: members (current or former) are the team, people from outside the
 * org (Connect guests, Slack or Discord authors) the customer, except a Slack author from our own
 * workspace, who is the team.
 */
export const classifyAuthor = (
	facts: AuthorFacts,
	override: AuthorSideOverride | null,
): AuthorClassification => {
	if (facts._tag === "Bot") return decided("bot", "bot")
	if (override !== null) return decided(override, "override")
	switch (facts._tag) {
		case "Member":
			return decided("team", "org_member")
		case "FormerMember":
			return decided("team", "former_member")
		case "ConnectGuest":
			return decided("customer", "connect_guest")
		case "External":
			// Only a Slack workspace tells teams apart: a Discord server holds both sides.
			if (facts.provider !== "slack") return decided("customer", "external")
			return facts.workspace === "home"
				? decided("team", "external_home_workspace")
				: facts.workspace === "other"
					? decided("customer", "external_other_workspace")
					: decided("customer", "external")
		case "Unknown":
			return decided("unknown", "unknown")
	}
}

/** Sides that take part in a support conversation (waiting on, first replies): not bots or unknowns. */
export const isConversational = (side: AuthorSide): side is "customer" | "team" =>
	side === "customer" || side === "team"

/** A short, plain explanation of a reason, for tooltips and the customer page. */
export const authorSideReasonLabel = {
	override: "Set by hand",
	org_member: "Member of your organization",
	former_member: "Former member of your organization",
	connect_guest: "From the other organization in this Connect channel",
	external_other_workspace: "From another Slack workspace",
	external_home_workspace: "From your Slack workspace",
	external: "Posted through Slack or Discord",
	bot: "Bot or integration",
	unknown: "Not known",
} satisfies Record<AuthorSideReason, string>

/** Chat-sync shadow users' `externalId`: `<provider>-user-<provider user id>`. */
const SHADOW_EXTERNAL_ID = /^(slack|discord)-user-/

/** The provider of a chat-sync shadow user, from its directory `externalId`; `null` for anyone else. */
export const shadowProviderOf = (externalId: string): string | null =>
	SHADOW_EXTERNAL_ID.exec(externalId)?.[1] ?? null
