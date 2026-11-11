import { Theme } from "@hazel/domain/models"
import { Option, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToast, errorToastOf, successToast, warningToast } from "../../data/actions"
import type { ToastRequest } from "../../overlay/toasts"
import { AppRoute, hrefOf, type RouteOf } from "../../route"
import type { ThemeCustomization, ThemeMode } from "../../theme"
import * as Interaction from "../../ui/aria/interaction"
import * as ChoiceBox from "../../ui/choice-box"
import type { Shared } from "../contract"
import { PageOutMessage } from "../out-message"
import {
	DebounceTimezoneQuery,
	LoadOnboardingHome,
	ReadBrowserTimezone,
	SendInvites,
	UpdateProfile,
	UpdateUserTimezone,
} from "./command"
import { Message } from "./message"
import { type Model, Phase, type Running, type StepOf, StepState, type UpdateUserFailure } from "./model"
import { CITIES } from "./timezone/data"
import {
	advance,
	completeOnboarding,
	enterStep,
	finalize,
	goBack,
	type Return,
	setStep,
	startWhenReady,
	withPhase,
} from "./transition"
import { filledEmails, inviteRowError, isProfileValid, MAX_INVITES } from "./validation"

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

/** Before the flow runs, or while it still can: finishing it must not race a redirect. */
const canRedirect = (model: Model): boolean =>
	Phase.match(model.phase, {
		Starting: () => true,
		Leaving: () => false,
		Running: ({ step }) => step._tag !== "Finalizing" && step._tag !== "Completed",
	})

/** The reverse guard: an onboarded user who lands here goes to the app root, once. */
const redirectIfOnboarded = (model: Model, shared: Shared): Return =>
	shared.currentUser?.isOnboarded && canRedirect(model)
		? {
				model: modifyFields(model, { phase: () => Phase.Leaving() }),
				outMessage: PageOutMessage.RequestedNavigation({ route: AppRoute.Root(), replace: false }),
			}
		: { model }

export const init = (route: RouteOf<"Onboarding">, shared: Shared): Return => {
	const model: Model = {
		urlStep: Option.getOrNull(route.step),
		orgId: Option.getOrNull(route.orgId),
		phase: Phase.Starting({ membership: Option.none(), browserTimezone: Option.none() }),
		interaction: Interaction.init(),
	}
	const redirected = redirectIfOnboarded(model, shared)
	return { ...redirected, commands: [ReadBrowserTimezone()] }
}

const isStep = <Tag extends StepState["_tag"]>(step: StepState, tag: Tag): step is StepOf<Tag> =>
	step._tag === tag

/** Step Messages apply only while their step is showing. */
const withStep = <Tag extends StepState["_tag"]>(
	model: Model,
	tag: Tag,
	f: (step: StepOf<Tag>, running: Running) => Return,
): Return => {
	const { phase } = model
	return phase._tag === "Running" && isStep(phase.step, tag) ? f(phase.step, phase) : { model }
}

const withRunning = (model: Model, f: (running: Running) => Return): Return =>
	model.phase._tag === "Running" ? f(model.phase) : { model }

/** The profile defaults come from `user.me`, which may arrive after the step was entered. */
export const sharedChanged = (model: Model, shared: Shared): Return => {
	const seeded = withStep(model, "Profile", (form, running) => ({
		model:
			!form.hasChanged && shared.currentUser && !form.firstName && !form.lastName
				? setStep(
						model,
						running,
						StepState.Profile({
							...form,
							firstName: shared.currentUser.firstName,
							lastName: shared.currentUser.lastName,
						}),
					)
				: model,
	})).model
	return redirectIfOnboarded(seeded, shared)
}

const decodeHexColor = Schema.decodeUnknownOption(Theme.HexColor)

/** `setTheme` / `setBrandColor`: the step previews its choice on the whole app through the root. */
const requestTheme = (model: Model, mode: ThemeMode, customization: ThemeCustomization): Return => ({
	model,
	outMessage: PageOutMessage.RequestedTheme({ preference: { mode, customization } }),
})

const updateUserFailureToast = (reason: UpdateUserFailure) =>
	errorToastOf(
		failureMessage(reason, {
			UserNotFound: {
				title: "User not found",
				description: "Your account could not be found. Please try signing in again.",
			},
		}),
	)

const plural = (count: number) => `${count} invitation${count > 1 ? "s" : ""}`

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		DetectedBrowserTimezone: ({ browserTimezone }) =>
			model.phase._tag === "Starting"
				? startWhenReady(
						model,
						{ ...model.phase, browserTimezone: Option.some(browserTimezone) },
						shared,
					)
				: { model },
		// A running flow keeps its user type; the membership itself stays current.
		UpdatedMembership: ({ membership }) =>
			Phase.match(model.phase, {
				Starting: (starting) =>
					startWhenReady(model, { ...starting, membership: Option.some(membership) }, shared),
				Leaving: () => ({ model }),
				Running: (running) => ({
					model: withPhase(
						model,
						modifyFields(running, {
							flow: (flow) => modifyFields(flow, { membership: () => membership }),
						}),
					),
				}),
			}),
		ClickedBack: () => withRunning(model, (running) => goBack(model, running, shared)),
		ClickedGetStarted: () => withStep(model, "Welcome", (_, running) => advance(model, running, shared)),

		ChangedFirstName: ({ value }) =>
			withStep(model, "Profile", (form, running) => ({
				model: setStep(
					model,
					running,
					StepState.Profile({ ...form, firstName: value, hasChanged: true }),
				),
			})),
		ChangedLastName: ({ value }) =>
			withStep(model, "Profile", (form, running) => ({
				model: setStep(
					model,
					running,
					StepState.Profile({ ...form, lastName: value, hasChanged: true }),
				),
			})),
		SubmittedProfile: () =>
			withStep(model, "Profile", (form, running) => {
				if (form.isSubmitting) return { model }
				const userId = shared.currentUser?.id
				return !isProfileValid(form) || userId === undefined
					? { model: setStep(model, running, StepState.Profile({ ...form, hasChanged: true })) }
					: {
							model: setStep(
								model,
								running,
								StepState.Profile({ ...form, isSubmitting: true }),
							),
							commands: [
								UpdateProfile({
									userId,
									firstName: form.firstName.trim(),
									lastName: form.lastName.trim(),
								}),
							],
						}
			}),
		SucceededUpdateProfile: () =>
			withStep(model, "Profile", (form, running) =>
				form.isSubmitting ? advance(model, running, shared) : { model },
			),
		FailedUpdateProfile: ({ reason }) =>
			withStep(model, "Profile", (form, running) => ({
				model: setStep(model, running, StepState.Profile({ ...form, isSubmitting: false })),
				outMessage: toast(updateUserFailureToast(reason)),
			})),

		ChangedTimezoneQuery: ({ value }) =>
			withStep(model, "Timezone", (form, running) => ({
				model: setStep(model, running, StepState.Timezone({ ...form, query: value })),
				commands: [DebounceTimezoneQuery({ query: value })],
			})),
		ElapsedTimezoneDebounce: ({ query }) =>
			withStep(model, "Timezone", (form, running) => ({
				model:
					form.query === query
						? setStep(model, running, StepState.Timezone({ ...form, debouncedQuery: query }))
						: model,
			})),
		ClickedCity: ({ timezone }) =>
			withStep(model, "Timezone", (form, running) => ({
				model: setStep(model, running, StepState.Timezone({ ...form, selected: timezone })),
			})),
		ClickedOffset: ({ offset }) =>
			withStep(model, "Timezone", (form, running) => {
				const city = CITIES.find((candidate) => candidate.offset === offset)
				return {
					model: city
						? setStep(model, running, StepState.Timezone({ ...form, selected: city.timezone }))
						: model,
				}
			}),
		HoveredOffset: ({ offset }) =>
			withStep(model, "Timezone", (form, running) => ({
				model: setStep(model, running, StepState.Timezone({ ...form, hoveredOffset: offset })),
			})),
		ClickedDetectTimezone: () =>
			withStep(model, "Timezone", (form, running) => ({
				model: setStep(
					model,
					running,
					StepState.Timezone({
						...form,
						detectionAttempted: true,
						selected: running.flow.browserTimezone || form.selected,
					}),
				),
			})),
		ClickedContinueTimezone: () =>
			withStep(model, "Timezone", (form, running) =>
				form.isSubmitting || form.selected === null || shared.currentUser === null
					? { model }
					: {
							model: setStep(
								model,
								running,
								StepState.Timezone({ ...form, isSubmitting: true }),
							),
							commands: [
								UpdateUserTimezone({
									userId: shared.currentUser.id,
									timezone: form.selected,
								}),
							],
						},
			),
		SucceededUpdateTimezone: ({ timezone }) =>
			withStep(model, "Timezone", (form, running) =>
				form.isSubmitting ? advance(model, running, shared, { timezone: () => timezone }) : { model },
			),
		FailedUpdateTimezone: ({ reason }) =>
			withStep(model, "Timezone", (form, running) => ({
				model: setStep(model, running, StepState.Timezone({ ...form, isSubmitting: false })),
				outMessage: toast(updateUserFailureToast(reason)),
			})),

		SelectedBrandColor: ({ hex }) =>
			withStep(model, "Theme", () =>
				Option.match(decodeHexColor(hex), {
					onNone: () => ({ model }),
					onSome: (primary) =>
						requestTheme(model, shared.theme.mode, { ...shared.theme.customization, primary }),
				}),
			),
		SelectedTheme: ({ theme }) =>
			withStep(model, "Theme", () => requestTheme(model, theme, shared.theme.customization)),
		ClickedContinueTheme: () => withStep(model, "Theme", (_, running) => advance(model, running, shared)),

		GotChoiceBoxMessage: ({ message: boxMessage }) =>
			withRunning(model, (running) => {
				const { step } = running
				if (step._tag !== "UseCases" && step._tag !== "Role") return { model }
				const result = ChoiceBox.update(step.box, boxMessage)
				return {
					model: setStep(
						model,
						running,
						step._tag === "UseCases"
							? StepState.UseCases({ box: result.model })
							: StepState.Role({ box: result.model }),
					),
					commands: Command.mapMessages(result.commands ?? [], (message) =>
						Message.GotChoiceBoxMessage({ message }),
					),
				}
			}),
		ClickedContinueChoice: () =>
			withRunning(model, (running) => {
				const { step } = running
				if (step._tag !== "UseCases" && step._tag !== "Role") return { model }
				const [selected] = step.box.selectedKeys
				if (selected === undefined) return { model }
				return step._tag === "UseCases"
					? advance(model, running, shared, { useCases: () => [selected] })
					: advance(model, running, shared, { role: () => selected })
			}),

		ChangedEmail: ({ rowId, value }) =>
			withStep(model, "Invite", (form, running) => ({
				model: setStep(
					model,
					running,
					StepState.Invite({
						...form,
						rows: form.rows.map((row) =>
							row.id === rowId ? { id: row.id, email: value, error: Option.none() } : row,
						),
					}),
				),
			})),
		ClickedAddEmail: () =>
			withStep(model, "Invite", (form, running) =>
				form.rows.length >= MAX_INVITES
					? { model }
					: {
							model: setStep(
								model,
								running,
								StepState.Invite({
									...form,
									rows: [
										...form.rows,
										{ id: form.nextRowId, email: "", error: Option.none() },
									],
									nextRowId: form.nextRowId + 1,
								}),
							),
						},
			),
		ClickedRemoveEmail: ({ rowId }) =>
			withStep(model, "Invite", (form, running) => {
				const rows = form.rows.filter((row) => row.id !== rowId)
				return {
					model: setStep(
						model,
						running,
						rows.length > 0
							? StepState.Invite({ ...form, rows })
							: StepState.Invite({
									...form,
									rows: [{ id: form.nextRowId, email: "", error: Option.none() }],
									nextRowId: form.nextRowId + 1,
								}),
					),
				}
			}),
		ClickedContinueInvite: () =>
			withStep(model, "Invite", (form, running) => {
				if (form.isSending) return { model }
				const emails = filledEmails(form.rows)
				if (emails.length === 0) return finalize(model, running, shared)
				const rows = form.rows.map((row) => ({ ...row, error: inviteRowError(row.email) }))
				if (rows.some((row) => Option.isSome(row.error)))
					return { model: setStep(model, running, StepState.Invite({ ...form, rows })) }
				const organizationId = running.flow.membership?.organizationId ?? model.orgId
				return organizationId === null
					? { model, outMessage: toast(errorToast("No active organization")) }
					: {
							model: setStep(model, running, StepState.Invite({ ...form, isSending: true })),
							commands: [SendInvites({ organizationId, emails })],
						}
			}),
		SucceededSendInvites: ({ emails, failedCount }) =>
			withStep(model, "Invite", (form, running) =>
				!form.isSending
					? { model }
					: {
							...finalize(model, running, shared),
							outMessage:
								failedCount === 0
									? toast(successToast(`Sent ${plural(emails.length)}`))
									: toast(
											warningToast(
												`Sent ${plural(emails.length - failedCount)}, ${failedCount} failed`,
											),
										),
						},
			),
		FailedSendInvites: () =>
			withStep(model, "Invite", (form, running) => ({
				model: setStep(model, running, StepState.Invite({ ...form, isSending: false })),
				outMessage: toast(errorToast("Failed to send invitations")),
			})),

		SucceededCompleteOnboarding: () =>
			withStep(model, "Finalizing", (_, running) => {
				const slug = running.flow.membership?.slug
				const completed = enterStep(model, running, "completed", {
					direction: "forward",
					shared,
					syncUrl: true,
				})
				return {
					...completed,
					commands: [
						...(completed.commands ?? []),
						LoadOnboardingHome({
							href: hrefOf(slug ? AppRoute.OrgHome({ orgSlug: slug }) : AppRoute.Root()),
						}),
					],
				}
			}),
		FailedCompleteOnboarding: ({ reason }) =>
			withStep(model, "Finalizing", (_, running) => ({
				model: setStep(model, running, StepState.Finalizing({ failure: Option.some(reason) })),
			})),
		ClickedRetryFinalize: () =>
			withStep(model, "Finalizing", ({ failure }, running) =>
				Option.isNone(failure)
					? { model }
					: {
							model: setStep(model, running, StepState.Finalizing({ failure: Option.none() })),
							commands: [completeOnboarding(running)],
						},
			),
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
