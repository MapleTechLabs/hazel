// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/$orgSlug/customers/settings/signals/$ruleId` (a rule) and `…/signals/new?template=` (a new rule
 * from a template): the rule editor (`settings/signals/RuleEditor.ts`) once the organization is known.
 */
import * as Customers from "@hazel/domain/customers"
import { CustomerSignalRuleId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Session } from "../../../../app/session"
import { RuleEditor } from "../../../settings/signals/RuleEditor"

export const SignalRulePageProps = Schema.Struct({
	session: Session,
	/** Null: a new rule from `template`. */
	ruleId: Schema.NullOr(CustomerSignalRuleId),
	template: Schema.NullOr(Customers.SignalTemplate),
	nowMs: Schema.Finite,
})
export type SignalRulePageProps = typeof SignalRulePageProps.Type

export const SignalRulePage = Hazel.component({
	name: "SignalRulePage",
	props: SignalRulePageProps,
	model: Schema.Struct({}),
	message: Schema.Never,
}).make({
	init: () => ({}),
	update: {},
	view: (h) => {
		const { session, ruleId, template, nowMs } = h.props
		const organization = session.organization
		if (organization === null)
			return h.screen
				.key("signal-rule")
				.surface("page")
				.children(h.progress.style("spinner").label("Loading the rule…"))
		// A new rule and each saved one are their own editor: a fresh form for each.
		const key: string = ruleId ?? `new:${template ?? ""}`
		return RuleEditor(h, {
			key,
			props: {
				organizationId: organization.id,
				orgSlug: session.orgSlug ?? organization.slug ?? "",
				role: session.member?.role ?? null,
				ruleId,
				template,
				nowMs,
			},
		})
	},
})
