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
	CustomerAccountId,
	CustomerConnectionId,
	CustomerIgnoreRuleId,
	CustomerNoteId,
	CustomerSavedViewId,
	CustomerSignalId,
	CustomerSignalRuleId,
	CustomerUnmatchedRecordId,
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
	LifecycleStage,
	SignalOutcome,
	SignalStatus,
} from "../customers/enums"
import { HealthSettings } from "../customers/health"
import {
	Connection,
	Event,
	IgnoreRule,
	Invoice,
	Note,
	SavedView,
	Signal,
	SignalRule,
	UnmatchedRecord,
} from "../customers/models"
import { RuleDraft } from "../customers/rules"
import { MAX_VIEWS, ViewDraft } from "../customers/views"
import { InternalServerError, UnauthorizedError } from "../errors"
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

/** The provider has no integration yet (its adapter is not registered). */
export class CustomerProviderUnavailableError extends Schema.TaggedError<CustomerProviderUnavailableError>()(
	"CustomerProviderUnavailableError",
	{ provider: CustomerProvider },
) {}

/** The provider refused the credentials (or could not be reached to check them). */
export class CustomerConnectionCredentialsError extends Schema.TaggedError<CustomerConnectionCredentialsError>()(
	"CustomerConnectionCredentialsError",
	{ provider: CustomerProvider, message: Schema.String, retryable: Schema.Boolean },
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

	/** Owner, tags, stage override (null clears it), name (a manual name beats every source). */
	write(
		"customers.account.update",
		{
			accountId: CustomerAccountId,
			ownerUserId: Schema.optionalKey(Schema.NullOr(UserId)),
			tags: Schema.optionalKey(Tags),
			lifecycleStageOverride: Schema.optionalKey(Schema.NullOr(LifecycleStage)),
			name: Schema.optionalKey(NonEmptyText(200)),
		},
		Tx,
		CustomersNotFoundError,
		/** The owner is not a member of the organization. */
		CustomersInvalidRequestError,
	),

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

	/** The caller's tab order: personal views, and (admins) shared ones. */
	write(
		"customers.view.reorder",
		{ viewIds: Schema.Array(CustomerSavedViewId).check(Schema.isMaxLength(2 * MAX_VIEWS)) },
		Tx,
	),
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

	/** Health weights, bands, steps; the reporting currency; add-on plans. Recomputes soon. */
	write(
		"customers.settings.update",
		{
			health: Schema.optionalKey(HealthSettings),
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

	write("customers.ignoreRule.delete", { ruleId: CustomerIgnoreRuleId }, Tx, CustomersNotFoundError),

	/** The unit a source's metric is shown in (`8.27 GB`); null: the source's own. Not for built-ins. */
	write(
		"customers.metric.setUnit",
		{ metricKey: NonEmptyText(200), unit: Schema.NullOr(NonEmptyText(40)) },
		Tx,
		CustomersNotFoundError,
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
