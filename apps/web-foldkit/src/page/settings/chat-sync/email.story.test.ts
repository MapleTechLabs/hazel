import "../../../test/document-stub"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { errorToastOf, successToast } from "../../../data/actions"
import { makeShared, organizationId } from "../../../test/pages-fixtures"
import { emailInbox, salesChannel, supportChannel } from "../../../test/pages-integrations-fixtures"
import { PageOutMessage } from "../../out-message"
import * as ConfirmAction from "../../shared/confirm-action"
import {
	CopyInboundAddress,
	CreateEmailInbox,
	emailFailureMessage,
	isEmailFormValid,
	nameError,
	RemoveEmailInbox,
	supportAddressError,
	UpdateEmailInbox,
} from "./email"
import { EmailStep, EmailSubmission, emptyEmailForm, Message, type Model } from "./model"
import { init, ListConnections, update } from "./update"

/** The Email support inboxes: the form's rules, creating, editing, copying and removing an inbox. */

const shared = makeShared()
const step = (current: Model, next: Message) => update(current, next, shared)
const loaded = [
	Message.SucceededListConnections({ organizationId, connections: [], emailInboxes: [emailInbox] }),
	Message.UpdatedHazelChannels({ channels: [supportChannel, salesChannel] }),
].reduce((current, next) => step(current, next).model, init(undefined, shared).model)

describe("the inbox form's rules", () => {
	test("a name is required and at most 80 characters", () => {
		expect(nameError("")).toBe("Enter a name for the inbox.")
		expect(nameError("   ")).toBe("Enter a name for the inbox.")
		expect(nameError("a".repeat(81))).toBe("Use 80 characters or fewer.")
		expect(nameError(" Acme Support ")).toBeNull()
	})

	test("the support address is optional, and checked when given", () => {
		expect(supportAddressError("")).toBeNull()
		expect(supportAddressError(" support@acme.com ")).toBeNull()
		expect(supportAddressError("support")).toBe("Enter an email address, like support@acme.com.")
		expect(supportAddressError("support@acme")).toBe("Enter an email address, like support@acme.com.")
	})

	test("a new inbox needs a channel; an edit does not", () => {
		const named = { ...emptyEmailForm, name: "Acme Support" }
		expect(isEmailFormValid(named)).toBe(false)
		expect(isEmailFormValid({ ...named, channel: supportChannel })).toBe(true)
		expect(isEmailFormValid({ ...named, step: EmailStep.Edit({ inbox: emailInbox }) })).toBe(true)
	})
})

describe("email inboxes", () => {
	test("the list keeps the inboxes apart from the Slack and Discord connections", () => {
		expect(loaded.emailInboxes).toEqual([emailInbox])
		expect(loaded.hazelChannels.map((channel) => channel.name)).toEqual(["sales", "support"])
	})

	test("Create shows the errors first; once valid it creates, then shows the forwarding setup", () => {
		const created = { ...emailInbox, supportAddress: null }
		story(
			step,
			given(loaded),
			message(Message.ClickedAddEmailInbox()),
			model((current) => expect(current.emailModal.isOpen).toBe(true)),
			message(Message.ClickedSubmitEmailInbox()),
			Command.expectNone(),
			model((current) => expect(current.emailForm.isValidated).toBe(true)),
			message(Message.ChangedEmailName({ value: "  Acme Support " })),
			message(Message.ClickedEmailChannel({ channel: supportChannel })),
			message(Message.ClickedSubmitEmailInbox()),
			Command.expectExact(
				CreateEmailInbox({
					organizationId,
					displayName: "Acme Support",
					supportAddress: null,
					hazelChannelId: supportChannel.id,
				}),
			),
			model((current) => expect(current.emailForm.submission).toEqual(EmailSubmission.Submitting())),
			Command.resolve(CreateEmailInbox, Message.SucceededCreateEmailInbox({ inbox: created })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Email inbox created") })),
			model((current) => {
				expect(current.emailModal.isOpen).toBe(true)
				expect(current.emailForm.step).toEqual(EmailStep.Setup({ inbox: created, isNew: true }))
			}),
			Command.resolve(
				ListConnections,
				Message.SucceededListConnections({
					organizationId,
					connections: [],
					emailInboxes: [created],
				}),
			),
		)
	})

	test("a channel that has an inbox already keeps the form open with the reason", () => {
		story(
			step,
			given(loaded),
			message(Message.ClickedAddEmailInbox()),
			message(Message.ChangedEmailName({ value: "Acme Support" })),
			message(Message.ChangedEmailSupportAddress({ value: "support@acme.com" })),
			message(Message.ClickedEmailChannel({ channel: supportChannel })),
			message(Message.ClickedSubmitEmailInbox()),
			Command.expectExact(
				CreateEmailInbox({
					organizationId,
					displayName: "Acme Support",
					supportAddress: "support@acme.com",
					hazelChannelId: supportChannel.id,
				}),
			),
			Command.resolve(CreateEmailInbox, Message.FailedSaveEmailInbox({ reason: "ChannelLinked" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: errorToastOf(emailFailureMessage("ChannelLinked")) }),
			),
			model((current) => {
				expect(current.emailModal.isOpen).toBe(true)
				expect(current.emailForm.channel).toEqual(supportChannel)
				expect(current.emailForm.submission).toEqual(
					EmailSubmission.Failed({ reason: "ChannelLinked" }),
				)
			}),
		)
	})

	test("an invalid support address is not sent", () => {
		story(
			step,
			given(loaded),
			message(Message.ClickedAddEmailInbox()),
			message(Message.ChangedEmailName({ value: "Acme Support" })),
			message(Message.ChangedEmailSupportAddress({ value: "support" })),
			message(Message.ClickedEmailChannel({ channel: supportChannel })),
			message(Message.ClickedSubmitEmailInbox()),
			Command.expectNone(),
		)
	})

	test("Edit starts from the inbox; clearing the support address sends null", () => {
		story(
			step,
			given(loaded),
			message(Message.ClickedEditEmailInbox({ inbox: emailInbox })),
			model((current) => {
				expect(current.emailForm.name).toBe("Acme Support")
				expect(current.emailForm.supportAddress).toBe("support@acme.com")
			}),
			message(Message.ChangedEmailName({ value: "Acme Help" })),
			message(Message.ChangedEmailSupportAddress({ value: "" })),
			message(Message.ClickedSubmitEmailInbox()),
			Command.expectExact(
				UpdateEmailInbox({
					organizationId,
					syncConnectionId: emailInbox.id,
					displayName: "Acme Help",
					supportAddress: null,
				}),
			),
			Command.resolve(UpdateEmailInbox, Message.SucceededUpdateEmailInbox()),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Inbox updated") })),
			model((current) => {
				expect(current.emailModal.isOpen).toBe(false)
				expect(current.emailForm).toEqual(emptyEmailForm)
			}),
			Command.resolve(
				ListConnections,
				Message.SucceededListConnections({ organizationId, connections: [], emailInboxes: [] }),
			),
		)
	})

	test("copying the forwarding address toasts", () => {
		story(
			step,
			given(loaded),
			message(Message.ClickedCopyInboundAddress({ address: "acme-support-7f3k@in.hazel.sh" })),
			Command.resolve(CopyInboundAddress, Message.SucceededCopyInboundAddress()),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Forwarding address copied") }),
			),
		)
	})

	test("removing asks first, then deletes the connection and drops the inbox from the list", () => {
		story(
			step,
			given(loaded),
			message(Message.ClickedRemoveEmailInbox({ target: { id: emailInbox.id, name: "Acme Support" } })),
			model((current) => expect(current.removeInboxConfirm.modal.isOpen).toBe(true)),
			message(Message.ClickedConfirmRemoveEmailInbox()),
			Command.expectExact(RemoveEmailInbox({ organizationId, syncConnectionId: emailInbox.id })),
			model((current) => expect(ConfirmAction.isRunning(current.removeInboxConfirm)).toBe(true)),
			Command.resolve(RemoveEmailInbox, Message.SucceededRemoveEmailInbox()),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Inbox removed") })),
			model((current) => {
				expect(current.removeInboxConfirm.modal.isOpen).toBe(false)
				expect(current.emailInboxes).toEqual([])
			}),
			Command.resolve(
				ListConnections,
				Message.SucceededListConnections({ organizationId, connections: [], emailInboxes: [] }),
			),
		)
	})
})
