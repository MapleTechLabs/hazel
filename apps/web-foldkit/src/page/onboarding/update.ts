import { Theme } from "@hazel/domain/models"
import { Option, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { errorToast, successToast, warningToast } from "../../data/actions"
import type { ToastRequest } from "../../overlay/toasts"
import * as Interaction from "../../ui/aria/interaction"
import * as ChoiceBox from "../../ui/choice-box"
import { AppRoute, hrefOf, type RouteOf } from "../../route"
import type { ThemeCustomization, ThemeMode } from "../../theme"
import type { Shared } from "../contract"
import { PageOutMessage } from "../out-message"
import {
	DebounceTimezoneQuery,
	LoadHome,
	ReadBrowserTimezone,
	SendInvites,
	UpdateProfile,
	UpdateTimezone,
} from "./command"
import { Message } from "./message"
import { type Model, StepForm } from "./model"
import { CITIES } from "./timezone/data"
import { advance, enterStep, finalize, goBack, initializeWhenReady, type Return } from "./transition"

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

/** The reverse guard: an onboarded user who lands here goes to the app root. */
const redirectIfOnboarded = (model: Model, shared: Shared): Return =>
	shared.currentUser?.isOnboarded && !model.hasRedirected
		? {
				model: modifyFields(model, { hasRedirected: () => true }),
				outMessage: PageOutMessage.RequestedNavigation({ href: "/", replace: false }),
			}
		: { model }

export const init = (route: RouteOf<"Onboarding">, shared: Shared): Return => {
	const model: Model = {
		urlStep: Option.getOrNull(route.step),
		orgId: Option.getOrNull(route.orgId),
		membership: undefined,
		isInitialized: false,
		step: "welcome",
		direction: "forward",
		animatesStep: false,
		userType: "creator",
		data: { timezone: null, useCases: [], role: null, emails: [] },
		form: StepForm.None(),
		error: null,
		browserTimezone: undefined,
		hasRedirected: false,
		interaction: Interaction.init(),
	}
	const redirected = redirectIfOnboarded(model, shared)
	return { ...redirected, commands: [ReadBrowserTimezone()] }
}

/** The profile defaults come from `user.me`, which may arrive after the step was entered. */
export const sharedChanged = (model: Model, shared: Shared): Return => {
	const { form } = model
	const seeded =
		form._tag === "Profile" && !form.hasChanged && shared.currentUser && !form.firstName && !form.lastName
			? modifyFields(model, {
					form: () =>
						StepForm.Profile({
							...form,
							firstName: shared.currentUser?.firstName ?? "",
							lastName: shared.currentUser?.lastName ?? "",
						}),
				})
			: model
	return redirectIfOnboarded(seeded, shared)
}

const decodeHexColor = Schema.decodeUnknownOption(Theme.HexColor)

/** `setTheme` / `setBrandColor`: the step previews its choice on the whole app through the root. */
const requestTheme = (model: Model, mode: ThemeMode, customization: ThemeCustomization): Return => ({
	model,
	outMessage: PageOutMessage.RequestedTheme({ preference: { mode, customization } }),
})

const hasTag = <Tag extends StepForm["_tag"]>(
	form: StepForm,
	tag: Tag,
): form is Extract<StepForm, { _tag: Tag }> => form._tag === tag

/** Step Messages apply only while their step's form is showing. */
const withForm = <Tag extends StepForm["_tag"]>(
	model: Model,
	tag: Tag,
	f: (form: Extract<StepForm, { _tag: Tag }>) => Return,
): Return => {
	const form = model.form
	return hasTag(form, tag) ? f(form) : { model }
}

const setForm = (model: Model, form: StepForm): Model => modifyFields(model, { form: () => form })

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		GotBrowserTimezone: ({ browserTimezone }) =>
			initializeWhenReady(modifyFields(model, { browserTimezone: () => browserTimezone }), shared),
		UpdatedMembership: ({ membership }) =>
			initializeWhenReady(modifyFields(model, { membership: () => membership }), shared),
		ClickedBack: () => goBack(model, shared),
		ClickedGetStarted: () => advance(model, shared),

		ChangedFirstName: ({ value }) =>
			withForm(model, "Profile", (form) => ({
				model: setForm(model, StepForm.Profile({ ...form, firstName: value, hasChanged: true })),
			})),
		ChangedLastName: ({ value }) =>
			withForm(model, "Profile", (form) => ({
				model: setForm(model, StepForm.Profile({ ...form, lastName: value, hasChanged: true })),
			})),
		SubmittedProfile: () =>
			withForm(model, "Profile", (form) => {
				if (form.isSubmitting) return { model }
				const firstName = form.firstName.trim()
				const lastName = form.lastName.trim()
				return !firstName || !lastName
					? { model: setForm(model, StepForm.Profile({ ...form, hasChanged: true })) }
					: {
							model: setForm(model, StepForm.Profile({ ...form, isSubmitting: true })),
							commands: [UpdateProfile({ firstName, lastName })],
						}
			}),
		SucceededUpdateProfile: () => withForm(model, "Profile", () => advance(model, shared)),
		FailedUpdateProfile: () =>
			withForm(model, "Profile", (form) => ({
				model: setForm(model, StepForm.Profile({ ...form, isSubmitting: false })),
				outMessage: toast(errorToast("Failed to update profile")),
			})),

		ChangedTimezoneQuery: ({ value }) =>
			withForm(model, "Timezone", (form) => ({
				model: setForm(model, StepForm.Timezone({ ...form, query: value })),
				commands: [DebounceTimezoneQuery({ query: value })],
			})),
		ElapsedTimezoneDebounce: ({ query }) =>
			withForm(model, "Timezone", (form) => ({
				model:
					form.query === query
						? setForm(model, StepForm.Timezone({ ...form, debouncedQuery: query }))
						: model,
			})),
		ClickedCity: ({ timezone }) =>
			withForm(model, "Timezone", (form) => ({
				model: setForm(model, StepForm.Timezone({ ...form, selected: timezone })),
			})),
		ClickedOffset: ({ offset }) =>
			withForm(model, "Timezone", (form) => {
				const city = CITIES.find((candidate) => candidate.offset === offset)
				return {
					model: city
						? setForm(model, StepForm.Timezone({ ...form, selected: city.timezone }))
						: model,
				}
			}),
		HoveredOffset: ({ offset }) =>
			withForm(model, "Timezone", (form) => ({
				model: setForm(model, StepForm.Timezone({ ...form, hoveredOffset: offset })),
			})),
		ClickedDetectTimezone: () =>
			withForm(model, "Timezone", (form) => ({
				model: setForm(
					model,
					StepForm.Timezone({
						...form,
						detectionAttempted: true,
						selected: model.browserTimezone || form.selected,
					}),
				),
			})),
		ClickedContinueTimezone: () =>
			withForm(model, "Timezone", (form) =>
				form.isSubmitting || form.selected === null || shared.currentUser === null
					? { model }
					: {
							model: setForm(model, StepForm.Timezone({ ...form, isSubmitting: true })),
							commands: [
								UpdateTimezone({ userId: shared.currentUser.id, timezone: form.selected }),
							],
						},
			),
		SucceededUpdateTimezone: ({ timezone }) =>
			withForm(model, "Timezone", () => advance(model, shared, { timezone })),
		FailedUpdateTimezone: ({ toast: request }) =>
			withForm(model, "Timezone", (form) => ({
				model: setForm(model, StepForm.Timezone({ ...form, isSubmitting: false })),
				outMessage: toast(request),
			})),

		SelectedBrandColor: ({ hex }) =>
			withForm(model, "Theme", () =>
				Option.match(decodeHexColor(hex), {
					onNone: () => ({ model }),
					onSome: (primary) =>
						requestTheme(model, shared.theme.mode, { ...shared.theme.customization, primary }),
				}),
			),
		SelectedTheme: ({ theme }) =>
			withForm(model, "Theme", () => requestTheme(model, theme, shared.theme.customization)),
		ClickedContinueTheme: () => withForm(model, "Theme", () => advance(model, shared)),

		GotChoiceBoxMessage: ({ message: boxMessage }) =>
			withForm(model, "Choice", (form) => {
				const result = ChoiceBox.update(form.box, boxMessage)
				return {
					model: setForm(model, StepForm.Choice({ box: result.model })),
					commands: Command.mapMessages(result.commands ?? [], (message) =>
						Message.GotChoiceBoxMessage({ message }),
					),
				}
			}),
		ClickedContinueChoice: () =>
			withForm(model, "Choice", (form) => {
				const [selected] = form.box.selectedKeys
				if (selected === undefined) return { model }
				return model.step === "useCases"
					? advance(model, shared, { useCases: [selected] })
					: advance(model, shared, { role: selected })
			}),

		ChangedEmail: ({ index, value }) =>
			withForm(model, "Invite", (form) => {
				const { [String(index)]: _cleared, ...errors } = form.errors
				return {
					model: setForm(
						model,
						StepForm.Invite({
							...form,
							emails: form.emails.map((email, i) => (i === index ? value : email)),
							errors,
						}),
					),
				}
			}),
		ClickedAddEmail: () =>
			withForm(model, "Invite", (form) => ({
				model: setForm(model, StepForm.Invite({ ...form, emails: [...form.emails, ""] })),
			})),
		ClickedRemoveEmail: ({ index }) =>
			withForm(model, "Invite", (form) => {
				const emails = form.emails.filter((_, i) => i !== index)
				// Errors are keyed by row index, so rows after the removed one move up by one.
				const errors = Object.fromEntries(
					Object.entries(form.errors).flatMap(([key, error]) => {
						const row = Number(key)
						return row === index ? [] : [[String(row > index ? row - 1 : row), error]]
					}),
				)
				return {
					model: setForm(
						model,
						StepForm.Invite({ ...form, emails: emails.length > 0 ? emails : [""], errors }),
					),
				}
			}),
		ClickedContinueInvite: () =>
			withForm(model, "Invite", (form) => {
				if (form.isLoading) return { model }
				const filled = form.emails.filter((email) => email.trim().length > 0)
				if (filled.length === 0) return finalize(model, shared, [])
				// Keyed by row index, which is how the view reads them.
				const errors = Object.fromEntries(
					form.emails.flatMap((email, index) =>
						email.trim().length === 0 || EMAIL_PATTERN.test(email)
							? []
							: [[String(index), "Please enter a valid email address"]],
					),
				)
				return Object.keys(errors).length > 0
					? { model: setForm(model, StepForm.Invite({ ...form, errors })) }
					: {
							model: setForm(model, StepForm.Invite({ ...form, isLoading: true })),
							commands: [SendInvites({ emails: filled })],
						}
			}),
		SucceededSendInvites: ({ emails, failedCount }) =>
			withForm(model, "Invite", () => {
				const plural = (count: number) => `${count} invitation${count > 1 ? "s" : ""}`
				const next = finalize(model, shared, emails)
				return {
					...next,
					outMessage:
						failedCount === 0
							? toast(successToast(`Sent ${plural(emails.length)}`))
							: toast(
									warningToast(
										`Sent ${plural(emails.length - failedCount)}, ${failedCount} failed`,
									),
								),
				}
			}),
		FailedSendInvites: ({ reason }) =>
			withForm(model, "Invite", (form) => ({
				model: setForm(model, StepForm.Invite({ ...form, isLoading: false })),
				outMessage: toast(
					errorToast(
						reason === "NoOrganization" ? "No active organization" : "Failed to send invitations",
					),
				),
			})),

		SucceededCompleteOnboarding: () => {
			const slug = model.membership?.slug
			const completed = enterStep(model, "completed", { direction: "forward", shared, syncUrl: true })
			return {
				...completed,
				commands: [
					...(completed.commands ?? []),
					LoadHome({ href: hrefOf(slug ? AppRoute.OrgHome({ orgSlug: slug }) : AppRoute.Root()) }),
				],
			}
		},
		FailedCompleteOnboarding: ({ error }) => ({
			model: modifyFields(model, { error: () => error }),
		}),
		CompletedReplaceStepUrl: () => ({ model }),
		CompletedLoadHome: () => ({ model }),
		CompletedAutoFocus: () => ({ model }),
		StartedGlobeAnimation: () => ({ model }),
		CompletedEnterAnimation: () => ({ model }),
		GotInteractionMessage: ({ message: interactionMessage }) => ({
			model: modifyFields(model, {
				interaction: (interaction) => Interaction.update(interaction, interactionMessage).model,
			}),
		}),
	})
