// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The rule editor's live preview seam (lane PK7b): what the editor hands the preview on every render,
 * and where it draws it (the editor's side column, under the cards on a phone). Until PK7b lands
 * the editor draws nothing there.
 */
import type * as Customers from "@hazel/domain/customers"
import type { CustomerSignalRuleId, OrganizationId } from "@hazel/schema"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { Option } from "effect"
import type { RuleForm } from "./model"

export interface RulePreviewInput {
	readonly organizationId: OrganizationId
	readonly orgSlug: string
	/** Null: a new rule, so the dry run compares with nothing saved. */
	readonly ruleId: CustomerSignalRuleId | null
	readonly form: RuleForm
	/** The draft to dry-run; none while a field is invalid. */
	readonly draft: Option.Option<Customers.RuleDraft>
	readonly currency: string
	readonly nowMs: number
}

/** PK7b replaces this with its `RulePreview` child (keyed by the rule, its dry run debounced on `draft`). */
export const rulePreview = <Msg>(_h: Hazel.H<Msg>, _input: RulePreviewInput): Hazel.NoTextInput<Msg> => null
