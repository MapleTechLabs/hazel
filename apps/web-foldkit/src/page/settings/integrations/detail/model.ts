import { T3CodeSharing } from "@hazel/domain/http"
import { IntegrationConnection } from "@hazel/domain/models"
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Field, makeRules, Rule } from "foldkit/fieldValidation"
import { defineTaggedUnion } from "foldkit/schema"
import * as ConfirmAction from "../../../shared/confirm-action"
import { Connection } from "../shared/connections"

export const CallbackStatus = Schema.Literals(["success", "error"])
export type CallbackStatus = typeof CallbackStatus.Type

/**
 * What the connection panel is waiting for. `Verifying` follows a successful OAuth callback until the
 * connection syncs in active; `Connecting` covers the OAuth URL request and the API key submit.
 */
export const Activity = defineTaggedUnion({
	Idle: {},
	Verifying: {},
	Connecting: {},
	Disconnecting: {},
})
export type Activity = typeof Activity.Type

const isBlank = (value: string) => value.trim() === ""
const isUrl = Rule.url()[0]

export const apiTokenRules = makeRules({ required: "Bearer token is required", isEmpty: isBlank })

/** The submit trims, so the URL check does too. */
export const apiBaseUrlRules = makeRules({
	required: "Base URL is required",
	isEmpty: isBlank,
	rules: [[(value: string) => isUrl(value.trim()), "Enter a full URL starting with https://"]],
})

/** The T3 Code environment address: required; the server checks the rest and its message shows inline. */
export const environmentUrlRules = makeRules({
	required: "Environment address is required",
	isEmpty: isBlank,
})

/** The member's T3 Code link (`T3CodeConnection`), with times as epoch milliseconds. */
export const T3CodeLink = Schema.Struct({
	environmentLabel: Schema.String,
	environmentUrl: Schema.String,
	status: IntegrationConnection.ConnectionStatus,
	expiresAtMs: Schema.NullOr(Schema.Number),
	connectedAtMs: Schema.Number,
	sharing: T3CodeSharing,
})
export type T3CodeLink = typeof T3CodeLink.Type

/** The link as `GET /integrations/t3code/:orgId` last returned it; refetched whenever its row syncs. */
export const T3CodeState = defineTaggedUnion({
	Loading: {},
	Loaded: { link: Schema.NullOr(T3CodeLink) },
	Failed: {},
})
export type T3CodeState = typeof T3CodeState.Type

/** A member the owner may share their environment with. */
export const T3CodeMember = Schema.Struct({
	userId: UserId,
	name: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type T3CodeMember = typeof T3CodeMember.Type

/** The sharing PUT: shown optimistically, `Saving` until the latest request settles. */
export const SharingSave = Schema.Literals(["Idle", "Saving", "Saved"])
export type SharingSave = typeof SharingSave.Type

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	integrationId: Schema.String,
	/** The org-level connection for this provider (first row), if any. */
	connection: Schema.NullOr(Connection),
	activity: Activity,
	apiToken: Field(Schema.String),
	apiBaseUrl: Field(Schema.String),
	/** `ConfigOptionRow` toggles, local only as in legacy. */
	enabledOptionIds: Schema.Array(Schema.String),
	t3Code: T3CodeState,
	environmentUrl: Field(Schema.String),
	/** The other org members, for the "Specific members" picker. */
	t3CodeMembers: Schema.Array(T3CodeMember),
	memberSearch: Schema.String,
	sharingSave: SharingSave,
	/** The latest sharing PUT; an older one's result is ignored. */
	sharingRequestId: Schema.Number,
	/** Disconnect asks first; the target is the environment label. */
	disconnectConfirm: ConfirmAction.Model(Schema.String),
})
export type Model = typeof Model.Type
