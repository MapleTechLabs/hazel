/**
 * The Customers RPCs (`docs/customers/tech-design.md` §2, §6). Every payload names its
 * `organizationId`: the api Worker routes the call to that org's `CustomersObject`.
 *
 * - `CustomerReadRpcs`: aggregates, time series, per-account detail, history pages, dry runs.
 * - `CustomerQueueRpcs`: the work any member does (signals, notes, owners, tags).
 * - `CustomerAdminRpcs`: settings, rules, views, data sources (admins and owners; personal views
 *   for anyone).
 *
 * Mutations answer a `transactionId` on the `customers:<orgId>` source, which the client awaits.
 */
import {
	ChannelId,
	CustomerAccountId,
	CustomerChannelLinkId,
	CustomerConnectionId,
	CustomerFeatureFlagId,
	CustomerContactId,
	CustomerIgnoreRuleId,
	CustomerIssueId,
	CustomerImpersonatorId,
	CustomerNoteId,
	CustomerSavedViewId,
	CustomerSignalId,
	CustomerSignalRuleId,
	CustomerUnmatchedRecordId,
	MessageId,
	OrganizationId,
	TransactionId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import {
	AccountDetail,
	ContactRow,
	HealthDryRunResult,
	MetricSeries,
	OverviewResult,
	Page,
	PageRequest,
	RuleDryRunResult,
	Sparkline,
} from "../customers/analytics"
import { ConnectionConfig } from "../customers/connections"
import {
	CustomerProvider,
	CustomerSource,
	CustomersRange,
	IssuePriority,
	IssueStatus,
	LifecycleStage,
	SignalOutcome,
	SignalStatus,
} from "../customers/enums"
import { HealthSettings } from "../customers/health"
import {
	ChannelLink,
	Connection,
	Contact,
	Event,
	FeatureFlag,
	IgnoreRule,
	Invoice,
	Issue,
	Note,
	SavedView,
	ViewLayout,
	Signal,
	SignalRule,
	UnmatchedRecord,
} from "../customers/models"
import { AuthorSideOverride } from "../customers/author-side"
import { AttentionSettings, RuleDraft } from "../customers/rules"
import { ViewDraft, ViewLayoutDraft } from "../customers/views"
import { InternalServerError, UnauthorizedError } from "../errors"
import { RateLimitExceededError } from "../rate-limit-errors"
import { JsonDate } from "../models/utils"
import { RequiredScopes } from "../scopes/required-scopes"
import { AuthMiddleware } from "./middleware"

// ---------------------------------------------------------------------------
// Input bounds (member-writable text and lists)
// ---------------------------------------------------------------------------

const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const NonEmptyText = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
/** An account's tags: ≤ 20, each ≤ 50 characters. */
const Tags = Schema.Array(Text(50)).check(Schema.isMaxLength(20))
/** An ignore rule's glob: ≤ 200 characters, ≤ 5 `*`. */
/** A new feature flag's key, as it will read in Clerk's `public_metadata`. */
const NewFeatureFlagKey = Schema.String.check(
	Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/, {
		message: "Letters, digits, `_`, `.`, `:` and `-`, at most 64, starting with a letter or digit",
	}),
)
/** Any flag's key: one Clerk already holds may be any metadata key (Clerk caps metadata at 8 KB). */
const FeatureFlagKey = NonEmptyText(8192)
const GlobPattern = NonEmptyText(200).check(
	Schema.makeFilter((pattern) => (pattern.split("*").length <= 6 ? undefined : "At most 5 wildcards")),
)

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CustomersNotFoundError extends Schema.TaggedError<CustomersNotFoundError>()(
	"CustomersNotFoundError",
	{
		entity: Schema.Literals([
			"account",
			"signal",
			"rule",
			"note",
			"view",
			"connection",
			"unmatched_record",
			"ignore_rule",
			"metric",
			"contact",
			/** No such channel in the org, or one the caller cannot see. */
			"channel",
			/** Nobody the org has seen in its channels. */
			"author",
			"issue",
			/** No such message in the channel, or one the caller cannot see. */
			"message",
		]),
		id: Schema.String,
	},
) {}

/** The action does not apply to the signal's status (e.g. snoozing an auto-resolved one). */
export class CustomerSignalTransitionError extends Schema.TaggedError<CustomerSignalTransitionError>()(
	"CustomerSignalTransitionError",
	{ signalId: CustomerSignalId, status: SignalStatus, action: Schema.String },
) {}

/** A well-formed request the store refuses, e.g. deleting a built-in view, linking to a deleted account. */
export class CustomersInvalidRequestError extends Schema.TaggedError<CustomersInvalidRequestError>()(
	"CustomersInvalidRequestError",
	{ message: Schema.String },
) {}

/**
 * A grouping of accounts the store refuses: linking an account to itself (`same_account`), to an
 * environment of another primary (`primary_is_environment`: no chains), or unlinking a primary
 * that has environments (`primary_has_environments`).
 */
export class CustomerGroupError extends Schema.TaggedError<CustomerGroupError>()("CustomerGroupError", {
	reason: Schema.Literals(["same_account", "primary_is_environment", "primary_has_environments"]),
	message: Schema.String,
}) {}

/** The provider has no integration yet (its adapter is not registered). */
export class CustomerProviderUnavailableError extends Schema.TaggedError<CustomerProviderUnavailableError>()(
	"CustomerProviderUnavailableError",
	{ provider: CustomerProvider },
) {}

/**
 * Clerk refused (or could not be reached for) some customers' feature flags: those listed are
 * unchanged, every other one was updated.
 */
export class CustomerFeatureFlagsError extends Schema.TaggedError<CustomerFeatureFlagsError>()(
	"CustomerFeatureFlagsError",
	{ message: Schema.String, failedAccountIds: Schema.Array(CustomerAccountId) },
) {}

/** The provider refused the credentials (or could not be reached to check them). */
export class CustomerConnectionCredentialsError extends Schema.TaggedError<CustomerConnectionCredentialsError>()(
	"CustomerConnectionCredentialsError",
	{ provider: CustomerProvider, message: Schema.String, retryable: Schema.Boolean },
) {}

/**
 * The provider would not start an impersonation: no live connection that can impersonate
 * (`unavailable`), the contact has no user there (`no_user`), impersonation is off in the
 * provider's settings (`disabled`), or the provider refused or failed (`provider`, its own
 * explanation in `message`, e.g. the monthly allowance used up).
 */
export class CustomerImpersonationError extends Schema.TaggedError<CustomerImpersonationError>()(
	"CustomerImpersonationError",
	{
		reason: Schema.Literals(["unavailable", "no_user", "disabled", "provider"]),
		message: Schema.String,
	},
) {}

const Tx = Schema.Struct({ transactionId: TransactionId })
const withTx = <S extends Schema.Top>(data: S) => Schema.Struct({ data, transactionId: TransactionId })

const org = { organizationId: OrganizationId }

/** An RPC on the org's `CustomersObject`: `extra` errors plus the auth and internal ones. */
const customersRpc =
	(scope: "customers:read" | "customers:write") =>
	<
		const Tag extends string,
		const P extends Schema.Struct.Fields,
		S extends Schema.Top,
		const E extends ReadonlyArray<Schema.Top>,
	>(
		tag: Tag,
		payload: P,
		success: S,
		...extra: E
	) =>
		Rpc.make(tag, {
			payload: Schema.Struct({ ...org, ...payload }),
			success,
			error: Schema.Union([...extra, UnauthorizedError, InternalServerError]),
		})
			.annotate(RequiredScopes, [scope])
			.middleware(AuthMiddleware)

const read = customersRpc("customers:read")
const write = customersRpc("customers:write")

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export class CustomerReadRpcs extends RpcGroup.make(
	/** KPIs, MRR movements, active users, health distribution, movers, recent churn and new. */
	read("customers.overview", { range: CustomersRange }, OverviewResult),

	/** Everything the customer page shows beyond the synced account row. */
	read("customers.account.detail", { accountId: CustomerAccountId }, AccountDetail, CustomersNotFoundError),

	/** Daily series of metrics (`active_users`, `mrr`, `health_score`, source metrics) over `range`. */
	read(
		"customers.account.series",
		{ accountId: CustomerAccountId, metricKeys: Schema.Array(Schema.String), range: CustomersRange },
		Schema.Struct({ series: Schema.Array(MetricSeries) }),
		CustomersNotFoundError,
	),

	/** One metric's last `days` daily values for many accounts: list and queue sparklines. */
	read(
		"customers.sparklines",
		{
			accountIds: Schema.Array(CustomerAccountId).check(Schema.isMaxLength(200)),
			metricKey: Schema.String,
			days: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 90 })),
		},
		Schema.Struct({ sparklines: Schema.Array(Sparkline) }),
	),

	read(
		"customers.contacts.list",
		{
			accountId: CustomerAccountId,
			...PageRequest,
		},
		Page(ContactRow),
		CustomersNotFoundError,
	),

	/** Contacts of any account whose name or email contains `query`: the command palette. */
	read(
		"customers.contacts.search",
		{
			query: NonEmptyText(200),
			limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
		},
		Schema.Struct({ contacts: Schema.Array(Contact.Schema) }),
	),

	read("customers.invoices.list", { accountId: CustomerAccountId, ...PageRequest }, Page(Invoice.Schema)),

	/** The timeline, newest first; one account's, or the org's. */
	read(
		"customers.events.list",
		{
			accountId: Schema.optionalKey(CustomerAccountId),
			providers: Schema.optionalKey(Schema.Array(CustomerSource).check(Schema.isMaxLength(10))),
			/** Type prefixes, e.g. `invoice.`, `signal.opened`. */
			types: Schema.optionalKey(Schema.Array(Text(100)).check(Schema.isMaxLength(20))),
			...PageRequest,
		},
		Page(Event.Schema),
	),

	/** Closed signals older than the synced window (30 days), newest first. */
	read(
		"customers.signals.history",
		{ accountId: Schema.optionalKey(CustomerAccountId), ...PageRequest },
		Page(Signal.Schema),
	),

	/** Evaluate a draft rule now, without writing. `ruleId`: compare with that rule's signals. */
	read(
		"customers.rule.dryRun",
		{ draft: RuleDraft, ruleId: Schema.optionalKey(CustomerSignalRuleId) },
		RuleDryRunResult,
	),

	/** Score every account under draft health settings, without writing. */
	read("customers.health.dryRun", { draft: HealthSettings }, HealthDryRunResult),

	read(
		"customers.unmatched.list",
		{
			connectionId: Schema.optionalKey(CustomerConnectionId),
			status: Schema.optionalKey(Schema.Literals(["open", "linked", "ignored"])),
			...PageRequest,
		},
		Schema.Struct({
			items: Schema.Array(UnmatchedRecord.Schema),
			nextCursor: Schema.NullOr(Schema.String),
			openCount: Schema.Int,
		}),
	),

	read("customers.ignoreRules.list", {}, Schema.Struct({ items: Schema.Array(IgnoreRule.Schema) })),

	/** Every plan name the org's subscriptions carry, any status, by name. */
	read("customers.plans.list", {}, Schema.Struct({ plans: Schema.Array(Schema.String) })),
) {}

// ---------------------------------------------------------------------------
// Queue work (any member)
// ---------------------------------------------------------------------------

export class CustomerQueueRpcs extends RpcGroup.make(
	write(
		"customers.signal.assign",
		/** The assignee must be a member of the organization (else `CustomersInvalidRequestError`). */
		{ signalId: CustomerSignalId, assigneeUserId: Schema.NullOr(UserId) },
		Tx,
		CustomersNotFoundError,
		CustomerSignalTransitionError,
		CustomersInvalidRequestError,
	),

	write(
		"customers.signal.snooze",
		{ signalId: CustomerSignalId, until: JsonDate, note: Schema.optionalKey(Text(2000)) },
		Tx,
		CustomersNotFoundError,
		CustomerSignalTransitionError,
	),

	write(
		"customers.signal.done",
		{ signalId: CustomerSignalId, outcome: SignalOutcome, note: Schema.optionalKey(Text(2000)) },
		Tx,
		CustomersNotFoundError,
		CustomerSignalTransitionError,
	),

	write(
		"customers.signal.dismiss",
		{ signalId: CustomerSignalId, reason: Schema.optionalKey(Text(500)) },
		Tx,
		CustomersNotFoundError,
		CustomerSignalTransitionError,
	),

	/** Undo a snooze, done or dismiss while the condition still holds. */
	write(
		"customers.signal.reopen",
		{ signalId: CustomerSignalId },
		Tx,
		CustomersNotFoundError,
		CustomerSignalTransitionError,
	),

	write(
		"customers.note.create",
		{
			/** Client-generated, for the optimistic row. */
			id: Schema.optionalKey(CustomerNoteId),
			accountId: CustomerAccountId,
			body: NonEmptyText(10_000),
			pinned: Schema.optionalKey(Schema.Boolean),
			signalId: Schema.optionalKey(CustomerSignalId),
		},
		withTx(Note.Schema),
		CustomersNotFoundError,
	),

	/** The author edits the body; anyone pins. */
	write(
		"customers.note.update",
		{
			noteId: CustomerNoteId,
			body: Schema.optionalKey(NonEmptyText(10_000)),
			pinned: Schema.optionalKey(Schema.Boolean),
		},
		withTx(Note.Schema),
		CustomersNotFoundError,
	),

	/** The author or an admin. */
	write("customers.note.delete", { noteId: CustomerNoteId }, Tx, CustomersNotFoundError),

	/**
	 * Owner, tags, stage override (null clears it), name (a manual name beats every source), and
	 * the Needs attention mute: `{ until }` mutes (`until` null: until unmuted), null unmutes.
	 */
	write(
		"customers.account.update",
		{
			accountId: CustomerAccountId,
			ownerUserId: Schema.optionalKey(Schema.NullOr(UserId)),
			tags: Schema.optionalKey(Tags),
			lifecycleStageOverride: Schema.optionalKey(Schema.NullOr(LifecycleStage)),
			name: Schema.optionalKey(NonEmptyText(200)),
			attentionMute: Schema.optionalKey(
				Schema.NullOr(Schema.Struct({ until: Schema.NullOr(JsonDate) })),
			),
		},
		Tx,
		CustomersNotFoundError,
		/** The owner is not a member of the organization. */
		CustomersInvalidRequestError,
	),

	/**
	 * Change a support issue (`docs/customers/issues.md`): any field given. Closing records who and
	 * when; a closed issue set to any other status reopens. The assignee must be a member.
	 */
	write(
		"customers.issue.update",
		{
			issueId: CustomerIssueId,
			status: Schema.optionalKey(IssueStatus),
			priority: Schema.optionalKey(IssuePriority),
			assigneeUserId: Schema.optionalKey(Schema.NullOr(UserId)),
			tags: Schema.optionalKey(Tags),
		},
		Tx,
		CustomersNotFoundError,
		CustomersInvalidRequestError,
	),

	/**
	 * Open an issue on a top-level message of a linked channel by hand (any author). The message's
	 * existing live issue is answered as it is. A channel that is not linked, or a thread, is
	 * refused (`CustomersInvalidRequestError`); a message the caller cannot see is `not_found`.
	 */
	write(
		"customers.issue.createFromMessage",
		{
			channelId: ChannelId,
			messageId: MessageId,
		},
		withTx(Issue.Schema),
		CustomersNotFoundError,
		CustomersInvalidRequestError,
	),

	/**
	 * Link a channel of the org (Hazel, Slack, Discord or Connect) to the account; a channel
	 * linked to another account moves here. The caller must see the channel; threads and direct
	 * messages are refused (`CustomersInvalidRequestError`).
	 */
	write(
		"customers.channel.link",
		{
			/** Client-generated, for the optimistic row. */
			id: Schema.optionalKey(CustomerChannelLinkId),
			accountId: CustomerAccountId,
			channelId: ChannelId,
		},
		withTx(ChannelLink.Schema),
		CustomersNotFoundError,
		CustomersInvalidRequestError,
	),

	/**
	 * Unlink the channel from whichever account it is linked to (none: a no-op). The caller must
	 * see the channel, as for linking.
	 */
	write("customers.channel.unlink", { channelId: ChannelId }, Tx, CustomersNotFoundError),

	/** The list's bulk actions. */
	write(
		"customers.account.bulkUpdate",
		{
			/** ≤ 500, else `CustomersInvalidRequestError`. */
			accountIds: Schema.Array(CustomerAccountId),
			ownerUserId: Schema.optionalKey(Schema.NullOr(UserId)),
			addTags: Schema.optionalKey(Tags),
			removeTags: Schema.optionalKey(Tags),
		},
		Schema.Struct({ updated: Schema.Int, transactionId: TransactionId }),
		CustomersInvalidRequestError,
	),

	/**
	 * Personal views for anyone; shared ones (`shared: true`) for admins. At most `MAX_VIEWS` of
	 * each (a person's own, the shared ones), else `CustomersInvalidRequestError`.
	 */
	write(
		"customers.view.create",
		{ id: Schema.optionalKey(CustomerSavedViewId), view: ViewDraft, shared: Schema.Boolean },
		withTx(SavedView.Schema),
		CustomersInvalidRequestError,
	),

	/** Own personal views; shared and built-in views for admins. */
	write(
		"customers.view.update",
		{ viewId: CustomerSavedViewId, view: ViewDraft },
		withTx(SavedView.Schema),
		CustomersNotFoundError,
	),

	/** Built-in views cannot be deleted. */
	write(
		"customers.view.delete",
		{ viewId: CustomerSavedViewId },
		Tx,
		CustomersNotFoundError,
		CustomersInvalidRequestError,
	),

	/** The caller's own order of the views and what the sidebar leaves out (replaces the last one). */
	write("customers.view.layout", { layout: ViewLayoutDraft }, withTx(ViewLayout.Schema)),
) {}

// ---------------------------------------------------------------------------
// Settings and data sources (admins and owners)
// ---------------------------------------------------------------------------

export class CustomerAdminRpcs extends RpcGroup.make(
	write(
		"customers.rule.create",
		{ rule: RuleDraft },
		withTx(SignalRule.Schema),
		CustomersInvalidRequestError,
	),

	write(
		"customers.rule.update",
		{ ruleId: CustomerSignalRuleId, rule: RuleDraft },
		withTx(SignalRule.Schema),
		CustomersNotFoundError,
		CustomersInvalidRequestError,
	),

	/** Its open signals close (`auto_resolved`). */
	write("customers.rule.delete", { ruleId: CustomerSignalRuleId }, Tx, CustomersNotFoundError),

	/** Health weights, bands, steps; who Needs attention covers; the reporting currency; add-on plans. Recomputes soon. */
	write(
		"customers.settings.update",
		{
			health: Schema.optionalKey(HealthSettings),
			attention: Schema.optionalKey(AttentionSettings),
			/** An ISO 4217 code, e.g. `usd`. */
			reportingCurrency: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[A-Za-z]{3}$/))),
			/** The whole list of add-on plan names. */
			addOnPlans: Schema.optionalKey(Schema.Array(Schema.String)),
		},
		Tx,
	),

	/** API-key connect: validates with the provider, stores the credentials encrypted, starts the backfill. */
	write(
		"customers.connection.connect",
		{
			provider: CustomerProvider,
			apiKey: Schema.String.check(Schema.isMinLength(1)),
			webhookSecret: Schema.NullOr(Schema.String),
			config: ConnectionConfig,
		},
		withTx(Connection.Schema),
		CustomerProviderUnavailableError,
		CustomerConnectionCredentialsError,
		CustomersInvalidRequestError,
	),

	/** New config and/or rotated credentials. */
	write(
		"customers.connection.update",
		{
			connectionId: CustomerConnectionId,
			config: Schema.optionalKey(ConnectionConfig),
			apiKey: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
			webhookSecret: Schema.optionalKey(Schema.NullOr(Schema.String)),
		},
		withTx(Connection.Schema),
		CustomersNotFoundError,
		CustomerProviderUnavailableError,
		CustomerConnectionCredentialsError,
		CustomersInvalidRequestError,
	),

	/** Drops the credentials and stops syncing; the data stays, marked stale. */
	write(
		"customers.connection.disconnect",
		{ connectionId: CustomerConnectionId },
		Tx,
		CustomersNotFoundError,
	),

	/** Run a sync now (`manual`); answers once it is scheduled. */
	write(
		"customers.connection.syncNow",
		{ connectionId: CustomerConnectionId },
		Tx,
		CustomersNotFoundError,
		CustomerProviderUnavailableError,
	),

	/**
	 * Make `accountId` an environment of `primaryAccountId`'s customer: it and the environments it
	 * is primary of join that group (accounts are never merged; each stays its own row). Both must
	 * be live and distinct, and `primaryAccountId` must not be an environment of another primary.
	 * The joining accounts' unclosed signals close: the group's are evaluated on the primary.
	 */
	write(
		"customers.account.link",
		{ accountId: CustomerAccountId, primaryAccountId: CustomerAccountId },
		Tx,
		CustomersNotFoundError,
		CustomerGroupError,
	),

	/**
	 * A non-primary environment leaves its group and stands alone. A primary with environments is
	 * refused (`primary_has_environments`: make another one primary first); a standalone account is
	 * left as it is.
	 */
	write(
		"customers.account.unlink",
		{ accountId: CustomerAccountId },
		Tx,
		CustomersNotFoundError,
		CustomerGroupError,
	),

	/**
	 * Make an environment the primary of its group: the old primary and the other environments point
	 * at it, and the group's unclosed signals move to it. Nothing changes for a primary or a
	 * standalone account.
	 */
	write("customers.account.setPrimary", { accountId: CustomerAccountId }, Tx, CustomersNotFoundError),

	/** Name an account's environment (`US`, `EU`), or clear it with null; blank clears it too. */
	write(
		"customers.account.setEnvironment",
		{ accountId: CustomerAccountId, environment: Schema.NullOr(Text(60)) },
		Tx,
		CustomersNotFoundError,
	),

	/** Link to an account (records a `manual` ref) and replay the record's data. */
	write(
		"customers.unmatched.link",
		{ recordId: CustomerUnmatchedRecordId, accountId: CustomerAccountId },
		Tx,
		CustomersNotFoundError,
		CustomersInvalidRequestError,
	),

	/** Create an account from an unmatched account record. */
	write(
		"customers.unmatched.createAccount",
		{ recordId: CustomerUnmatchedRecordId },
		withTx(Schema.Struct({ accountId: CustomerAccountId })),
		CustomersNotFoundError,
		CustomersInvalidRequestError,
	),

	/** Ignore it; with `rule`, also the open and future records matching it. */
	write(
		"customers.unmatched.ignore",
		{
			recordId: CustomerUnmatchedRecordId,
			rule: Schema.optionalKey(
				Schema.Struct({
					field: Schema.Literals(["email", "domain", "name", "external_id"]),
					pattern: GlobPattern,
				}),
			),
		},
		/** Every record it ignored: this one, and the open ones the rule covers. */
		withTx(Schema.Struct({ ignoredRecordIds: Schema.Array(CustomerUnmatchedRecordId) })),
		CustomersNotFoundError,
		/** The record is not open. */
		CustomersInvalidRequestError,
	),

	/**
	 * A feature flag no customer holds yet, so it can be assigned (`customers.featureFlags.set`).
	 * A key already created is `CustomersInvalidRequestError`.
	 */
	write(
		"customers.featureFlag.create",
		{
			/** Client-generated, for the optimistic row. */
			id: Schema.optionalKey(CustomerFeatureFlagId),
			key: NewFeatureFlagKey,
		},
		withTx(FeatureFlag.Schema),
		CustomersInvalidRequestError,
	),

	/**
	 * Remove the key from the `public_metadata` of every Clerk organization that holds it, then
	 * forget the flag. With `CustomerFeatureFlagsError` the flag stays, on the customers it lists.
	 */
	write(
		"customers.featureFlag.delete",
		{ key: FeatureFlagKey },
		Tx,
		CustomersInvalidRequestError,
		CustomerFeatureFlagsError,
	),

	/**
	 * Turn every key on (`true` in each account's Clerk organizations' `public_metadata`) or off (the
	 * key removed) for every account. An account with no live Clerk organization, or no active Clerk
	 * connection, is `CustomersInvalidRequestError` before anything is written. No list cap: the
	 * pickers offer every customer and every flag, and Clerk bounds an organization's metadata (8 KB).
	 */
	write(
		"customers.featureFlags.set",
		{
			accountIds: Schema.Array(CustomerAccountId).check(Schema.isMinLength(1)),
			keys: Schema.Array(FeatureFlagKey).check(Schema.isMinLength(1)),
			enabled: Schema.Boolean,
		},
		Tx,
		CustomersNotFoundError,
		CustomersInvalidRequestError,
		CustomerFeatureFlagsError,
	),

	write("customers.ignoreRule.delete", { ruleId: CustomerIgnoreRuleId }, Tx, CustomersNotFoundError),

	/** The unit a source's metric is shown in (`8.27 GB`); null: the source's own. Not for built-ins. */
	write(
		"customers.metric.setUnit",
		{ metricKey: NonEmptyText(200), unit: Schema.NullOr(NonEmptyText(40)) },
		Tx,
		CustomersNotFoundError,
	),

	/** Let a member sign in as customers' users (Clerk impersonation). Admins and owners. */
	write(
		"customers.impersonator.grant",
		{
			/** Client-generated, for the optimistic row. */
			id: Schema.optionalKey(CustomerImpersonatorId),
			userId: UserId,
		},
		Tx,
		CustomersInvalidRequestError,
	),

	/**
	 * Take the grant back. A link already handed out still works for its minute, and a session it
	 * opened for at most 15 minutes.
	 */
	write("customers.impersonator.revoke", { userId: UserId }, Tx),

	/**
	 * Sign in as the contact's user in the customer's app: answers the provider's one-time sign-in
	 * URL (valid for a minute), for the caller only. Members with a grant, not admins as such.
	 */
	write(
		"customers.impersonation.start",
		{ contactId: CustomerContactId },
		withTx(Schema.Struct({ url: Schema.String })),
		CustomersNotFoundError,
		CustomerImpersonationError,
		RateLimitExceededError,
	),

	/**
	 * Dev and preview stages only: fill the org with realistic fake customers through the ingest
	 * path, then compute. Refused (`CustomersInvalidRequestError`) where demo data is disabled.
	 */
	write(
		"customers.demo.seed",
		{ accounts: Schema.optionalKey(Schema.Int), seed: Schema.optionalKey(Schema.Int) },
		Tx,
		CustomersInvalidRequestError,
	),
) {}

export const CustomerRpcs = CustomerReadRpcs.merge(CustomerQueueRpcs, CustomerAdminRpcs)

// ---------------------------------------------------------------------------
// The caller's organizations (the directory, not an org's object)
// ---------------------------------------------------------------------------

export const CustomerOrganization = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
})
export type CustomerOrganization = typeof CustomerOrganization.Type

/**
 * `customers.organizations`: the organizations the caller is a member of (`membership_index`,
 * `org_index`), by name, for a client that picks whose customers to show before it can name one
 * (the Raycast extension). The api Worker answers it over the directory.
 */
export class CustomerDirectoryRpcs extends RpcGroup.make(
	Rpc.make("customers.organizations", {
		payload: Schema.Struct({}),
		success: Schema.Struct({ organizations: Schema.Array(CustomerOrganization) }),
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["customers:read"])
		.middleware(AuthMiddleware),
) {}

// ---------------------------------------------------------------------------
// Who writes in linked channels (the org's object, not the customers object)
// ---------------------------------------------------------------------------

/**
 * `customers.chatAuthor.setSide`: a member marks someone as our team or the customer in the
 * org's linked channels, or clears the mark (`null`); `docs/customers/author-side.md`. The api
 * Worker routes it to the org's `OrgObject`, which holds the authors (`customer_chat_authors`).
 * Bots stay bots.
 */
export class CustomerChatRpcs extends RpcGroup.make(
	Rpc.make("customers.chatAuthor.setSide", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			userId: UserId,
			side: Schema.NullOr(AuthorSideOverride),
		}),
		success: Tx,
		error: Schema.Union([CustomersNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["customers:write"])
		.middleware(AuthMiddleware),
) {}
