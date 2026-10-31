import { BotId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"

/** What the consent page shows about the bot asking to be installed. */
export const BotSummary = Schema.Struct({
	id: BotId,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
	creatorName: Schema.String,
})
export type BotSummary = typeof BotSummary.Type

/** An organization the signed-in user could install into (they administer it). */
export const InstallTarget = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
})
export type InstallTarget = typeof InstallTarget.Type

/** The link's own parameters, once they check out. */
export const Request = Schema.Struct({
	botId: BotId,
	redirectUri: Schema.String,
	state: Schema.String,
})
export type Request = typeof Request.Type

/**
 * `bot.getInstallRequest`. `Invalid` is a link that cannot be honoured: parameters missing, an
 * unknown bot, or a redirect the bot never registered. It never sends the browser anywhere.
 */
export const Lookup = defineTaggedUnion({
	Loading: {},
	Loaded: { bot: BotSummary },
	Invalid: {},
	Failed: { reason: CommonReason },
})
export type Lookup = typeof Lookup.Type

export const ApproveFailure = Schema.Union([Schema.Literals(["NotAdmin", "Invalid"]), CommonReason])
export type ApproveFailure = typeof ApproveFailure.Type

/** Approving (or cancelling) stays in flight until the browser leaves for the redirect. */
export const Approval = defineTaggedUnion({
	Idle: {},
	Approving: {},
	Leaving: {},
	Failed: { reason: ApproveFailure },
})
export type Approval = typeof Approval.Type

export const Model = Schema.Struct({
	/** This link, to come back to after signing in. */
	returnTo: Schema.String,
	request: Schema.NullOr(Request),
	lookup: Lookup,
	/** `null` until the membership query answers. */
	targets: Schema.NullOr(Schema.Array(InstallTarget)),
	selectedOrganizationId: Schema.NullOr(OrganizationId),
	approval: Approval,
})
export type Model = typeof Model.Type
