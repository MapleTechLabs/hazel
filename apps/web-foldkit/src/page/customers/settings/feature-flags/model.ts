import { CustomerAccountId } from "@hazel/schema"
import { Schema } from "effect"
import { featureFlagKeysOf, hasFlag } from "../../../../customers/feature-flags"
import { AccountRow } from "../../../../customers/queries"
import * as Modal from "../../../../ui/modal"
import * as Popover from "../../../../ui/popover"

/**
 * Feature flags: the boolean keys of the customers' Clerk `public_metadata`, plus the ones created
 * here. A flag opens to the customers that have it; admins create, delete and assign flags.
 */

export const Model = Schema.Struct({
	/** The flags created in Hazel (`customer_feature_flags`). */
	created: Schema.Array(Schema.String),
	/** The org's live accounts; null until they sync. */
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	/** The flag whose customers show. */
	selectedKey: Schema.NullOr(Schema.String),
	newKey: Schema.String,
	customerPopover: Popover.Model,
	customerSearch: Schema.String,
	/** The customers ticked in the "Add customers" picker. */
	customerSelection: Schema.Array(CustomerAccountId),
	/** The flag the delete confirmation asks about (kept while the dialog animates out). */
	deletingKey: Schema.NullOr(Schema.String),
	deleteModal: Modal.Model,
})
export type Model = typeof Model.Type

export const CUSTOMER_POPOVER_ID = "feature-flag-customers"
export const DELETE_MODAL_ID = "feature-flag-delete"

export const flagKeysOf = (model: Model): ReadonlyArray<string> =>
	featureFlagKeysOf(model.created, model.accounts ?? [])

/** The customers that have `key` on, by name. */
export const customersWith = (model: Model, key: string): ReadonlyArray<AccountRow> =>
	(model.accounts ?? []).filter((account) => hasFlag(account, key))
