import { Popover as PopoverControl } from "@foldkit/ui"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { FEATURE_FLAG_KEY, featureFlagToast } from "../../../../customers/feature-flags"
import { successToast } from "../../../../data/actions"
import * as Modal from "../../../../ui/modal"
import * as Popover from "../../../../ui/popover"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { isCustomersAdmin } from "../shared"
import { CreateFeatureFlag, DeleteFeatureFlag, SetFeatureFlagCustomers } from "./commands"
import { type FlagAction, Message } from "./message"
import { CUSTOMER_POPOVER_ID, DELETE_MODAL_ID, flagKeysOf, type Model } from "./model"

type Return = PageReturn<Model, Message>

const FAILED_TITLE = {
	create: "Couldn't create the feature flag",
	delete: "Couldn't delete the feature flag",
	assign: "Couldn't turn the flag on",
	unassign: "Couldn't turn the flag off",
} satisfies Record<FlagAction, string>

export const init = (): Return => ({
	model: {
		created: [],
		accounts: null,
		selectedKey: null,
		newKey: "",
		customerPopover: Popover.init(CUSTOMER_POPOVER_ID),
		customerSearch: "",
		customerSelection: [],
		deletingKey: null,
		deleteModal: Modal.init(DELETE_MODAL_ID),
	},
})

const toast = (request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) =>
	PageOutMessage.RequestedToast({ toast: request })

/** The organization, when an admin acts. */
const adminOrg = (shared: Shared) => (isCustomersAdmin(shared) ? (shared.organization?.id ?? null) : null)

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedCreated: ({ keys }) => ({ model: modifyFields(model, { created: () => keys }) }),
		UpdatedAccounts: ({ accounts }) => ({ model: modifyFields(model, { accounts: () => accounts }) }),
		PressedFlag: ({ key }) => ({
			model: modifyFields(model, {
				selectedKey: (selected) => (selected === key ? null : key),
				customerSelection: () => [],
				customerSearch: () => "",
			}),
		}),
		ChangedNewKey: ({ value }) => ({ model: modifyFields(model, { newKey: () => value }) }),
		SubmittedNewKey: () => {
			const organizationId = adminOrg(shared)
			const createdBy = shared.currentUser?.id
			const key = model.newKey.trim()
			if (organizationId === null || createdBy === undefined || !FEATURE_FLAG_KEY.test(key))
				return { model }
			if (flagKeysOf(model).includes(key))
				return { model: modifyFields(model, { newKey: () => "", selectedKey: () => key }) }
			return {
				model: modifyFields(model, { newKey: () => "", selectedKey: () => key }),
				commands: [CreateFeatureFlag({ organizationId, key, createdBy })],
			}
		},

		PressedDeleteFlag: ({ key }) => ({
			model: modifyFields(model, {
				deletingKey: () => key,
				deleteModal: (modal) => Modal.open(modal).model,
			}),
		}),
		GotDeleteModalMessage: ({ message: modalMessage }) => {
			const result = Modal.update(model.deleteModal, modalMessage)
			return {
				model: modifyFields(model, { deleteModal: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotDeleteModalMessage({ message: child }),
				),
			}
		},
		PressedConfirmDelete: () => {
			const organizationId = adminOrg(shared)
			const key = model.deletingKey
			// The dialog may be closing already (a second press while it animates out).
			if (!model.deleteModal.isOpen || organizationId === null || key === null) return { model }
			return {
				model: modifyFields(model, {
					deleteModal: (modal) => Modal.close(modal).model,
					deletingKey: () => null,
					selectedKey: (selected) => (selected === key ? null : selected),
				}),
				commands: [DeleteFeatureFlag({ organizationId, key })],
			}
		},

		GotCustomerPopoverMessage: ({ message: popoverMessage }) => {
			const result = Popover.update(model.customerPopover, popoverMessage)
			return {
				model: modifyFields(model, { customerPopover: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotCustomerPopoverMessage({ message: child }),
				),
			}
		},
		ChangedCustomerSearch: ({ value }) => ({
			model: modifyFields(model, { customerSearch: () => value }),
		}),
		ToggledCustomer: ({ accountId, isSelected }) => ({
			model: modifyFields(model, {
				customerSelection: (selection) =>
					isSelected ? [...selection, accountId] : selection.filter((id) => id !== accountId),
			}),
		}),
		PressedAddCustomers: () => {
			const organizationId = adminOrg(shared)
			const key = model.selectedKey
			const accountIds = model.customerSelection
			const closed = PopoverControl.close(model.customerPopover)
			const next = modifyFields(model, {
				customerSelection: () => [],
				customerSearch: () => "",
				customerPopover: () => closed.model,
			})
			const commands = Command.mapMessages(closed.commands ?? [], (child) =>
				Message.GotCustomerPopoverMessage({ message: child }),
			)
			if (organizationId === null || key === null || accountIds.length === 0)
				return { model: next, commands }
			return {
				model: next,
				commands: [
					...commands,
					SetFeatureFlagCustomers({ organizationId, key, accountIds, enabled: true }),
				],
			}
		},
		PressedRemoveCustomer: ({ accountId }) => {
			const organizationId = adminOrg(shared)
			const key = model.selectedKey
			return organizationId === null || key === null
				? { model }
				: {
						model,
						commands: [
							SetFeatureFlagCustomers({
								organizationId,
								key,
								accountIds: [accountId],
								enabled: false,
							}),
						],
					}
		},

		SucceededFlagAction: ({ action }) =>
			action === "delete"
				? { model, outMessage: toast(successToast("Feature flag deleted")) }
				: { model },
		// The collections roll back; what Clerk accepted comes back through the stream.
		FailedFlagAction: ({ action, failure }) => ({
			model,
			outMessage: toast(featureFlagToast(FAILED_TITLE[action], failure)),
		}),
	})
