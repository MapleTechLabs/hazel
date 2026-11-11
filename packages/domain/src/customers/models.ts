/**
 * Row models of the `customers` store (`@hazel/db` `tables/customers.ts`), in the shape the sync
 * stream and the RPCs carry them: timestamps as `JsonDate`, JSON columns parsed.
 *
 * Synced (client collections): `Account`, `Signal`, `SignalRule`, `Note`, `SavedView`, `Settings`,
 * `MetricDefinition`, `Connection`, `SyncRun`. The rest travel in RPC results.
 */
import {
	CustomerAccountId,
	CustomerConnectionId,
	CustomerContactId,
	CustomerEventId,
	CustomerExternalRefId,
	CustomerIgnoreRuleId,
	CustomerInvoiceId,
	CustomerMetricDefinitionId,
	CustomerNoteId,
	CustomerSavedViewId,
	CustomerSettingsId,
	CustomerSignalId,
	CustomerSignalRuleId,
	CustomerSubscriptionId,
	CustomerSyncRunId,
	CustomerUnmatchedRecordId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Schema as S } from "effect"
import * as M from "../models/utils"
import { JsonDate } from "../models/utils"
import { ConnectionConfig, SyncError, SyncProgress, SyncStats } from "./connections"
import {
	BillingInterval,
	BuiltInViewKey,
	ConnectionStatus,
	CustomerProvider,
	CustomerSource,
	HealthStatus,
	IgnoreRuleField,
	InvoiceStatus,
	LifecycleStage,
	MatchMethod,
	MetricAggregation,
	RefEntityType,
	SignalKind,
	SignalOutcome,
	SignalSeverity,
	SignalStatus,
	SignalTemplate,
	SubscriptionStatus,
	SyncRunStatus,
	SyncTrigger,
	UnmatchedEntityType,
	UnmatchedStatus,
} from "./enums"
import { SignalEvidence } from "./evidence"
import { HealthSettings } from "./health"
import { RuleConfig, RuleScope } from "./rules"
import { ListColumn, ViewFilters, ViewSort } from "./views"

const NullDate = S.NullOr(JsonDate)
const FieldSources = S.Record(S.String, CustomerSource)
const Attributes = S.Record(S.String, S.Unknown)
const timestamps = {
	createdAt: M.Generated(JsonDate),
	updatedAt: M.Generated(JsonDate),
}

// ---------------------------------------------------------------------------
// Synced
// ---------------------------------------------------------------------------

class AccountModel extends M.Class<AccountModel>("CustomerAccount")({
	id: M.Generated(CustomerAccountId),
	organizationId: OrganizationId,
	name: S.String,
	domains: S.Array(S.String),
	logoUrl: S.NullOr(S.String),
	ownerUserId: S.NullOr(UserId),
	lifecycleStage: LifecycleStage,
	lifecycleStageOverride: S.NullOr(LifecycleStage),
	planName: S.NullOr(S.String),
	mrrMinor: S.Int,
	currency: S.String,
	trialListMrrMinor: S.NullOr(S.Int),
	trialEndsAt: NullDate,
	healthScore: S.NullOr(S.Int),
	healthStatus: HealthStatus,
	healthUpdatedAt: NullDate,
	seatsUsed: S.NullOr(S.Int),
	seatsLimit: S.NullOr(S.Int),
	contactCount: S.Int,
	activeUsers30d: S.Int,
	activeUsersTrendPct: S.NullOr(S.Number),
	openRiskHigh: S.Int,
	openRiskMedium: S.Int,
	openRiskLow: S.Int,
	openOpportunities: S.Int,
	championContactId: S.NullOr(CustomerContactId),
	championInactiveSince: NullDate,
	lastActiveContactId: S.NullOr(CustomerContactId),
	firstSeenAt: JsonDate,
	lastActiveAt: NullDate,
	customerSince: NullDate,
	churnedAt: NullDate,
	tags: S.Array(S.String),
	attributes: Attributes,
	fieldSources: FieldSources,
	...timestamps,
	deletedAt: M.GeneratedByApp(NullDate),
}) {}
export const Account = M.expose(AccountModel)
export type Account = typeof Account.Schema.Type

class SignalModel extends M.Class<SignalModel>("CustomerSignal")({
	id: M.Generated(CustomerSignalId),
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	ruleId: CustomerSignalRuleId,
	template: SignalTemplate,
	kind: SignalKind,
	severity: SignalSeverity,
	status: SignalStatus,
	title: S.String,
	reason: S.String,
	evidence: SignalEvidence,
	openingEvidence: SignalEvidence,
	actionEvidence: S.NullOr(SignalEvidence),
	priorityScore: S.Number,
	firstDetectedAt: JsonDate,
	openedAt: JsonDate,
	lastEvaluatedAt: JsonDate,
	assigneeUserId: S.NullOr(UserId),
	snoozedUntil: NullDate,
	snoozedByUserId: S.NullOr(UserId),
	snoozedAt: NullDate,
	snoozeNote: S.NullOr(S.String),
	resolvedAt: NullDate,
	resolvedByUserId: S.NullOr(UserId),
	outcome: S.NullOr(SignalOutcome),
	resolutionNote: S.NullOr(S.String),
	dismissReason: S.NullOr(S.String),
	reopenAfter: NullDate,
	reopenCount: S.Int,
	closedAt: NullDate,
	...timestamps,
}) {}
export const Signal = M.expose(SignalModel)
export type Signal = typeof Signal.Schema.Type

class SignalRuleModel extends M.Class<SignalRuleModel>("CustomerSignalRule")({
	id: M.Generated(CustomerSignalRuleId),
	organizationId: OrganizationId,
	name: S.String,
	template: SignalTemplate,
	kind: SignalKind,
	severity: SignalSeverity,
	config: RuleConfig,
	scope: RuleScope,
	enabled: S.Boolean,
	createdBy: S.NullOr(UserId),
	updatedBy: S.NullOr(UserId),
	lastTriggeredAt: NullDate,
	matchingCount: S.Int,
	...timestamps,
	deletedAt: M.GeneratedByApp(NullDate),
}) {}
export const SignalRule = M.expose(SignalRuleModel)
export type SignalRule = typeof SignalRule.Schema.Type

class NoteModel extends M.Class<NoteModel>("CustomerNote")({
	id: M.GeneratedOptional(CustomerNoteId),
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	authorUserId: UserId,
	body: S.String,
	pinned: S.Boolean,
	signalId: S.NullOr(CustomerSignalId),
	editedAt: NullDate,
	...timestamps,
	deletedAt: M.GeneratedByApp(NullDate),
}) {}
export const Note = M.expose(NoteModel)
export type Note = typeof Note.Schema.Type

class SavedViewModel extends M.Class<SavedViewModel>("CustomerSavedView")({
	id: M.GeneratedOptional(CustomerSavedViewId),
	organizationId: OrganizationId,
	name: S.String,
	ownerUserId: S.NullOr(UserId),
	builtInKey: S.NullOr(BuiltInViewKey),
	filters: ViewFilters,
	sort: ViewSort,
	columns: S.Array(ListColumn),
	position: S.Number,
	createdBy: S.NullOr(UserId),
	...timestamps,
	deletedAt: M.GeneratedByApp(NullDate),
}) {}
export const SavedView = M.expose(SavedViewModel)
export type SavedView = typeof SavedView.Schema.Type

class SettingsModel extends M.Class<SettingsModel>("CustomerSettings")({
	id: M.Generated(CustomerSettingsId),
	organizationId: OrganizationId,
	health: HealthSettings,
	reportingCurrency: S.String,
	lastComputedAt: NullDate,
	updatedBy: S.NullOr(UserId),
	...timestamps,
}) {}
export const Settings = M.expose(SettingsModel)
export type Settings = typeof Settings.Schema.Type

class MetricDefinitionModel extends M.Class<MetricDefinitionModel>("CustomerMetricDefinition")({
	id: M.Generated(CustomerMetricDefinitionId),
	organizationId: OrganizationId,
	key: S.String,
	name: S.String,
	unit: S.NullOr(S.String),
	aggregation: MetricAggregation,
	provider: S.NullOr(CustomerProvider),
	description: S.NullOr(S.String),
	builtIn: S.Boolean,
	...timestamps,
}) {}
export const MetricDefinition = M.expose(MetricDefinitionModel)
export type MetricDefinition = typeof MetricDefinition.Schema.Type

class ConnectionModel extends M.Class<ConnectionModel>("CustomerConnection")({
	id: M.Generated(CustomerConnectionId),
	organizationId: OrganizationId,
	provider: CustomerProvider,
	status: ConnectionStatus,
	externalAccountId: S.NullOr(S.String),
	externalAccountName: S.NullOr(S.String),
	config: ConnectionConfig,
	connectedBy: UserId,
	connectedAt: JsonDate,
	hasWebhookSecret: S.Boolean,
	lastSyncAt: NullDate,
	lastSuccessAt: NullDate,
	lastErrorAt: NullDate,
	lastError: S.NullOr(SyncError),
	consecutiveFailures: S.Int,
	nextSyncAt: NullDate,
	backfilledAt: NullDate,
	stats: SyncStats,
	disconnectedAt: NullDate,
	...timestamps,
}) {}
export const Connection = M.expose(ConnectionModel)
export type Connection = typeof Connection.Schema.Type

class SyncRunModel extends M.Class<SyncRunModel>("CustomerSyncRun")({
	id: M.Generated(CustomerSyncRunId),
	organizationId: OrganizationId,
	connectionId: CustomerConnectionId,
	provider: CustomerProvider,
	trigger: SyncTrigger,
	status: SyncRunStatus,
	startedAt: JsonDate,
	finishedAt: NullDate,
	progress: S.NullOr(SyncProgress),
	stats: SyncStats,
	error: S.NullOr(SyncError),
	cursor: S.NullOr(S.String),
}) {}
export const SyncRun = M.expose(SyncRunModel)
export type SyncRun = typeof SyncRun.Schema.Type

// ---------------------------------------------------------------------------
// RPC-only
// ---------------------------------------------------------------------------

class ContactModel extends M.Class<ContactModel>("CustomerContact")({
	id: M.Generated(CustomerContactId),
	accountId: CustomerAccountId,
	email: S.NullOr(S.String),
	name: S.NullOr(S.String),
	avatarUrl: S.NullOr(S.String),
	title: S.NullOr(S.String),
	role: S.NullOr(S.String),
	isBillingContact: S.Boolean,
	joinedAt: NullDate,
	firstActiveAt: NullDate,
	lastSeenAt: NullDate,
	lastSignInAt: NullDate,
	signInCount30d: S.Int,
	eventCount30d: S.Int,
	attributes: Attributes,
	fieldSources: FieldSources,
	...timestamps,
	deletedAt: M.GeneratedByApp(NullDate),
}) {}
export const Contact = M.expose(ContactModel)
export type Contact = typeof Contact.Schema.Type

class ExternalRefModel extends M.Class<ExternalRefModel>("CustomerExternalRef")({
	id: M.Generated(CustomerExternalRefId),
	connectionId: CustomerConnectionId,
	provider: CustomerProvider,
	entityType: RefEntityType,
	entityId: S.String,
	accountId: CustomerAccountId,
	externalId: S.String,
	externalUrl: S.NullOr(S.String),
	matchMethod: MatchMethod,
	matchedByUserId: S.NullOr(UserId),
	matchedAt: JsonDate,
	lastSyncedAt: NullDate,
	staleAt: NullDate,
	...timestamps,
}) {}
export const ExternalRef = M.expose(ExternalRefModel)
export type ExternalRef = typeof ExternalRef.Schema.Type

export const PaymentMethod = S.Struct({
	brand: S.NullOr(S.String),
	last4: S.NullOr(S.String),
	expMonth: S.NullOr(S.Int),
	expYear: S.NullOr(S.Int),
})
export type PaymentMethod = typeof PaymentMethod.Type

class SubscriptionModel extends M.Class<SubscriptionModel>("CustomerSubscription")({
	id: M.Generated(CustomerSubscriptionId),
	accountId: CustomerAccountId,
	provider: CustomerProvider,
	externalId: S.String,
	planName: S.NullOr(S.String),
	status: SubscriptionStatus,
	mrrMinor: S.Int,
	listMrrMinor: S.NullOr(S.Int),
	currency: S.String,
	interval: BillingInterval,
	quantity: S.Int,
	startedAt: NullDate,
	trialEndsAt: NullDate,
	currentPeriodEnd: NullDate,
	cancelAtPeriodEnd: S.Boolean,
	canceledAt: NullDate,
	cancellationReason: S.NullOr(S.String),
	paymentMethod: S.NullOr(PaymentMethod),
	...timestamps,
}) {}
export const Subscription = M.expose(SubscriptionModel)
export type Subscription = typeof Subscription.Schema.Type

class InvoiceModel extends M.Class<InvoiceModel>("CustomerInvoice")({
	id: M.Generated(CustomerInvoiceId),
	accountId: CustomerAccountId,
	subscriptionId: S.NullOr(CustomerSubscriptionId),
	provider: CustomerProvider,
	externalId: S.String,
	number: S.NullOr(S.String),
	status: InvoiceStatus,
	amountDueMinor: S.Int,
	amountPaidMinor: S.Int,
	currency: S.String,
	issuedAt: NullDate,
	dueAt: NullDate,
	paidAt: NullDate,
	attemptCount: S.Int,
	nextRetryAt: NullDate,
	declineReason: S.NullOr(S.String),
	hostedUrl: S.NullOr(S.String),
	...timestamps,
}) {}
export const Invoice = M.expose(InvoiceModel)
export type Invoice = typeof Invoice.Schema.Type

class EventModel extends M.Class<EventModel>("CustomerEvent")({
	id: M.Generated(CustomerEventId),
	accountId: CustomerAccountId,
	contactId: S.NullOr(CustomerContactId),
	provider: CustomerSource,
	type: S.String,
	title: S.String,
	data: Attributes,
	occurredAt: JsonDate,
	externalId: S.NullOr(S.String),
	actorUserId: S.NullOr(UserId),
	createdAt: M.Generated(JsonDate),
}) {}
export const Event = M.expose(EventModel)
export type Event = typeof Event.Schema.Type

class UnmatchedRecordModel extends M.Class<UnmatchedRecordModel>("CustomerUnmatchedRecord")({
	id: M.Generated(CustomerUnmatchedRecordId),
	connectionId: CustomerConnectionId,
	provider: CustomerProvider,
	entityType: UnmatchedEntityType,
	externalId: S.String,
	label: S.String,
	email: S.NullOr(S.String),
	domain: S.NullOr(S.String),
	valueMinor: S.NullOr(S.Int),
	currency: S.NullOr(S.String),
	eventCount30d: S.NullOr(S.Int),
	payload: S.Unknown,
	suggestedAccountId: S.NullOr(CustomerAccountId),
	confidence: S.NullOr(S.Number),
	reason: S.String,
	status: UnmatchedStatus,
	resolvedByUserId: S.NullOr(UserId),
	resolvedAt: NullDate,
	...timestamps,
}) {}
export const UnmatchedRecord = M.expose(UnmatchedRecordModel)
export type UnmatchedRecord = typeof UnmatchedRecord.Schema.Type

class IgnoreRuleModel extends M.Class<IgnoreRuleModel>("CustomerIgnoreRule")({
	id: M.Generated(CustomerIgnoreRuleId),
	provider: S.NullOr(CustomerProvider),
	entityType: UnmatchedEntityType,
	field: IgnoreRuleField,
	pattern: S.String,
	createdBy: UserId,
	createdAt: M.Generated(JsonDate),
}) {}
export const IgnoreRule = M.expose(IgnoreRuleModel)
export type IgnoreRule = typeof IgnoreRule.Schema.Type
