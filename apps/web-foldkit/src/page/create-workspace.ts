import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { load } from "foldkit/navigation"
import { defineTaggedUnion } from "foldkit/schema"
import { modifyFields } from "foldkit/struct"
import { CommonReason, failureMessage } from "~/lib/error-messages"
import { shareHost } from "../core/utils/share-origin"
import { catchCommon } from "../data/actions"
import { AppRoute, hrefOf } from "../route"
import { HazelRpc } from "../rpc"
import { button } from "../ui/button"
import { loader } from "../ui/loader"
import { textField } from "../ui/text-field"
import type { PageReturn } from "./contract"

/**
 * The "create your workspace" form shown to a user with no organization (onboarding's setup
 * step and the empty organization picker). Creating it makes the user its owner; the app then
 * reloads `/`, which carries on to onboarding or the new workspace.
 */

/** Why `organization.create` failed, beyond the shared reasons. */
export const CreateWorkspaceFailure = Schema.Union([Schema.Literals(["SlugTaken"]), CommonReason])
export type CreateWorkspaceFailure = typeof CreateWorkspaceFailure.Type

/**
 * `Invalid`: a submit was blocked by the fields, so their errors show from then on. `Submitting`
 * stays until the browser loads the new workspace.
 */
export const Submission = defineTaggedUnion({
	NotSubmitted: {},
	Invalid: {},
	Submitting: {},
	Failed: { reason: CreateWorkspaceFailure },
})
export type Submission = typeof Submission.Type

export const Model = Schema.Struct({
	name: Schema.String,
	slug: Schema.String,
	/** Once the slug is edited by hand it stops following the name. */
	isSlugEdited: Schema.Boolean,
	submission: Submission,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	ChangedName: { value: Schema.String },
	ChangedSlug: { value: Schema.String },
	SubmittedWorkspace: {},
	LeftForWorkspace: {},
	FailedCreateWorkspace: { reason: CreateWorkspaceFailure },
})
export type Message = typeof Message.Type

export const init = (): Model => ({
	name: "",
	slug: "",
	isSlugEdited: false,
	submission: Submission.NotSubmitted(),
})

/** `Acme Corp!` → `acme-corp`. */
export const slugify = (value: string) =>
	value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export const nameError = (model: Model) =>
	model.name.trim().length >= 2 ? null : "Enter a name with at least 2 characters"

export const slugError = (model: Model) =>
	model.slug.length >= 3 && SLUG_PATTERN.test(model.slug)
		? null
		: "Use at least 3 lowercase letters, numbers or hyphens"

export const CreateWorkspace = Command.define("CreateWorkspace", {
	args: { name: Schema.String, slug: Schema.String },
	messages: [Message.LeftForWorkspace, Message.FailedCreateWorkspace],
	execute: ({ name, slug }) =>
		HazelRpc.use((client) =>
			client("organization.create", { name, slug, logoUrl: null, settings: null, isPublic: false }),
		).pipe(
			// A full load, so user.me and the membership queries start from the new workspace.
			Effect.andThen(load(hrefOf(AppRoute.Root()))),
			Effect.as(Message.LeftForWorkspace()),
			Effect.catchTags({
				OrganizationSlugAlreadyExistsError: () =>
					Effect.succeed(Message.FailedCreateWorkspace({ reason: "SlugTaken" })),
			}),
			catchCommon((reason) => Message.FailedCreateWorkspace({ reason })),
		),
})

const failureText = (reason: CreateWorkspaceFailure): string => {
	const message = failureMessage(reason, {
		SlugTaken: { title: "That workspace URL is taken", description: "Pick another." },
	})
	return message.description === undefined ? message.title : `${message.title}. ${message.description}`
}

/** A taken URL is the slug field's problem, so it shows there; until the slug changes. */
const isSlugTaken = (submission: Submission) =>
	submission._tag === "Failed" && submission.reason === "SlugTaken"

/** A new slug may be free: drop the taken verdict, keeping the field errors on. */
const afterSlugChange = (model: Model, slug: string): Submission =>
	isSlugTaken(model.submission) && slug !== model.slug ? Submission.Invalid() : model.submission

type Return = PageReturn<Model, Message>

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ChangedName: ({ value }) => {
			const slug = model.isSlugEdited ? model.slug : slugify(value)
			return {
				model: modifyFields(model, {
					name: () => value,
					slug: () => slug,
					submission: () => afterSlugChange(model, slug),
				}),
			}
		},
		ChangedSlug: ({ value }) => {
			const slug = value.toLowerCase()
			return {
				model: modifyFields(model, {
					slug: () => slug,
					isSlugEdited: () => true,
					submission: () => afterSlugChange(model, slug),
				}),
			}
		},
		SubmittedWorkspace: () => {
			if (model.submission._tag === "Submitting") return { model }
			if (nameError(model) !== null || slugError(model) !== null)
				return { model: modifyFields(model, { submission: () => Submission.Invalid() }) }
			return {
				model: modifyFields(model, { submission: () => Submission.Submitting() }),
				commands: [CreateWorkspace({ name: model.name.trim(), slug: model.slug })],
			}
		},
		LeftForWorkspace: () => ({ model }),
		FailedCreateWorkspace: ({ reason }) => ({
			model: modifyFields(model, { submission: () => Submission.Failed({ reason }) }),
		}),
	})

export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	toParent: (message: Message) => ParentMessage,
): Html => {
	const showsErrors = model.submission._tag !== "NotSubmitted"
	const isSubmitting = model.submission._tag === "Submitting"
	const nameInvalid = showsErrors ? nameError(model) : null
	const slugInvalid = showsErrors
		? (slugError(model) ?? (isSlugTaken(model.submission) ? failureText("SlugTaken") : null))
		: null
	return h.form(
		[h.Class("flex w-full flex-col gap-4"), h.OnSubmit(toParent(Message.SubmittedWorkspace()))],
		[
			textField(
				h,
				{
					id: "create-workspace-name",
					value: model.name,
					isRequired: true,
					isInvalid: nameInvalid !== null,
					onInput: (value) => toParent(Message.ChangedName({ value })),
				},
				(field) => [
					field.label(["Workspace name"]),
					field.input({
						placeholder: "Acme Corp",
						attributes: [h.Attribute("autocomplete", "organization"), h.Autofocus(true)],
					}),
					field.fieldError([nameInvalid ?? ""]),
				],
			),
			textField(
				h,
				{
					id: "create-workspace-slug",
					value: model.slug,
					isRequired: true,
					isInvalid: slugInvalid !== null,
					onInput: (value) => toParent(Message.ChangedSlug({ value })),
				},
				(field) => [
					field.label(["Workspace URL"]),
					field.input({
						placeholder: "acme-corp",
						attributes: [
							h.Attribute("autocomplete", "off"),
							h.Attribute("autocapitalize", "none"),
							h.Attribute("autocorrect", "off"),
							h.Attribute("spellcheck", "false"),
						],
					}),
					field.description([`${shareHost()}/${model.slug || "acme-corp"}`]),
					// The server's verdict arrives after the press, so it is announced; the field's own rules aren't.
					field.fieldError(
						[slugInvalid ?? ""],
						isSlugTaken(model.submission) && slugError(model) === null
							? { attributes: [h.Role("alert")] }
							: {},
					),
				],
			),
			...(model.submission._tag === "Failed" && !isSlugTaken(model.submission)
				? [
						h.p(
							[h.Class("text-danger text-sm"), h.Role("alert")],
							[failureText(model.submission.reason)],
						),
					]
				: []),
			button(
				h,
				{
					intent: "primary",
					className: "mt-2 w-full",
					isDisabled: isSubmitting,
					onPress: toParent(Message.SubmittedWorkspace()),
				},
				isSubmitting
					? [loader(h, { className: "size-4" }), "Creating workspace..."]
					: ["Create workspace"],
			),
		],
	)
}
