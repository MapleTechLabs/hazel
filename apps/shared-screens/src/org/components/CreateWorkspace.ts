// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The "create your workspace" form (`web-foldkit/src/page/create-workspace.ts`) for a user with no
 * organization: the empty organization picker, and onboarding's setup step once it is native.
 * Creating it makes the user its owner; the app then loads `/` in full, which carries on to
 * onboarding or the new workspace.
 */
import { Command, UiSchema } from "@effect/ui"
import { HazelRpc } from "@hazel/client-data"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Match, Schema } from "effect"
import { LoadPage } from "../../app/requests"

/** Why `organization.create` failed: the URL is taken, or anything else. */
export const CreateWorkspaceFailure = Schema.Literals(["SlugTaken", "Other"])
export type CreateWorkspaceFailure = typeof CreateWorkspaceFailure.Type

/**
 * `Invalid`: a submit was blocked by the fields, so their errors show from then on. `Submitting`
 * stays until the browser loads the new workspace.
 */
export const Submission = UiSchema.TaggedEnum({
	NotSubmitted: {},
	Invalid: {},
	Submitting: {},
	Failed: { reason: CreateWorkspaceFailure },
})
export type Submission = typeof Submission.Type

export const CreateWorkspaceMessage = UiSchema.TaggedEnum({
	ChangedName: { payload: TextField.ChangePayload },
	ChangedSlug: { payload: TextField.ChangePayload },
	PressedCreate: {},
	SucceededCreate: {},
	FailedCreate: { reason: CreateWorkspaceFailure },
})
export type CreateWorkspaceMessage = typeof CreateWorkspaceMessage.Type

export const CreateWorkspaceProps = Schema.Struct({
	/** The host the workspace URL is shown under (`hazel.sh`). */
	shareHost: Schema.String,
})
export type CreateWorkspaceProps = typeof CreateWorkspaceProps.Type

export const CreateWorkspaceModel = Schema.Struct({
	name: TextField.State,
	slug: TextField.State,
	/** Once the slug is edited by hand it stops following the name. */
	isSlugEdited: Schema.Boolean,
	submission: Submission,
})
export type CreateWorkspaceModel = typeof CreateWorkspaceModel.Type

/** `organization.create` with the user as owner. */
export class CreateOrganization extends Command.Service<CreateOrganization>()(
	"hazel/org/CreateOrganization",
	{
		args: { name: Schema.String, slug: Schema.String },
		success: CreateWorkspaceMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const rpc = yield* HazelRpc
			return ({ name, slug }) =>
				rpc("organization.create", {
					name,
					slug,
					logoUrl: null,
					settings: null,
					isPublic: false,
				}).pipe(
					Effect.as(CreateWorkspaceMessage.SucceededCreate()),
					Effect.catchTags({
						OrganizationSlugAlreadyExistsError: () =>
							Effect.succeed(CreateWorkspaceMessage.FailedCreate({ reason: "SlugTaken" })),
					}),
					// BOUNDARY: every other failure (offline, signed out, the server) reads the same here.
					Effect.tapCause((cause) => Effect.logWarning("create workspace failed", cause)),
					Effect.catchCause(() =>
						Effect.succeed(CreateWorkspaceMessage.FailedCreate({ reason: "Other" })),
					),
				)
		}),
	)
}

/** `Acme Corp!` to `acme-corp`. */
export const slugify = (value: string) =>
	value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

export const nameError = (name: string) =>
	name.trim().length >= 2 ? null : "Enter a name with at least 2 characters"

export const slugError = (slug: string) =>
	slug.length >= 3 && SLUG_PATTERN.test(slug)
		? null
		: "Use at least 3 lowercase letters, numbers or hyphens"

const isSlugTaken = (submission: Submission) =>
	submission._tag === "Failed" && submission.reason === "SlugTaken"

/** A new slug may be free: drop the taken verdict, keeping the field errors on. */
const afterSlugChange = (model: CreateWorkspaceModel, slug: string): Submission =>
	isSlugTaken(model.submission) && slug !== model.slug.text ? Submission.Invalid() : model.submission

const failureText = (reason: CreateWorkspaceFailure) =>
	Match.value(reason).pipe(
		Match.when("SlugTaken", () => "That workspace URL is taken. Pick another."),
		Match.orElse(() => "Something went wrong. Please try again."),
	)

export const CreateWorkspace = Hazel.component({
	name: "CreateWorkspace",
	props: CreateWorkspaceProps,
	model: CreateWorkspaceModel,
	message: CreateWorkspaceMessage,
}).make({
	init: () => ({
		name: TextField.empty,
		slug: TextField.empty,
		isSlugEdited: false,
		submission: Submission.NotSubmitted(),
	}),
	update: {
		ChangedName: ($, { payload }) => {
			const name = TextField.changed($.model.name, payload)
			const slug = $.model.isSlugEdited ? $.model.slug : TextField.set($.model.slug, slugify(name.text))
			return $.set({ ...$.model, name, slug, submission: afterSlugChange($.model, slug.text) })
		},
		ChangedSlug: ($, { payload }) => {
			const typed = TextField.changed($.model.slug, payload)
			const lower = typed.text.toLowerCase()
			const slug = lower === typed.text ? typed : TextField.set(typed, lower)
			return $.set({
				...$.model,
				slug,
				isSlugEdited: true,
				submission: afterSlugChange($.model, lower),
			})
		},
		PressedCreate: ($) => {
			const { name, slug, submission } = $.model
			if (submission._tag === "Submitting") return $.model
			if (nameError(name.text) !== null || slugError(slug.text) !== null)
				return $.evolve({ submission: () => Submission.Invalid() })
			return $.evolve({ submission: () => Submission.Submitting() }).run(
				CreateOrganization.make({ name: name.text.trim(), slug: slug.text }),
			)
		},
		// A full load, so `user.me` and the membership queries start from the new workspace.
		SucceededCreate: ($) => $.run(LoadPage.make({ href: "/" })),
		FailedCreate: ($, { reason }) => $.evolve({ submission: () => Submission.Failed({ reason }) }),
	},
	view: (h, model) => {
		const showsErrors = model.submission._tag !== "NotSubmitted"
		const isSubmitting = model.submission._tag === "Submitting"
		const nameInvalid = showsErrors ? nameError(model.name.text) : null
		const slugInvalid = showsErrors
			? (slugError(model.slug.text) ??
				(isSlugTaken(model.submission) ? failureText("SlugTaken") : null))
			: null
		const failure =
			model.submission._tag === "Failed" && model.submission.reason !== "SlugTaken"
				? model.submission.reason
				: null
		// HAZEL-GAP(p4-field-autofocus): today's name field takes focus on arrival.
		return h.stack.key("create-workspace").children(
			h.textField
				.label("Workspace name")
				.placeholder("Acme Corp")
				.required()
				.value(model.name)
				.error(nameInvalid ?? undefined)
				.on("change", (payload) => CreateWorkspaceMessage.ChangedName({ payload }))
				.on("submit", () => CreateWorkspaceMessage.PressedCreate()),
			h.textField
				.label("Workspace URL")
				.placeholder("acme-corp")
				.required()
				.value(model.slug)
				.description(`${h.props.shareHost}/${model.slug.text || "acme-corp"}`)
				.error(slugInvalid ?? undefined)
				.on("change", (payload) => CreateWorkspaceMessage.ChangedSlug({ payload }))
				.on("submit", () => CreateWorkspaceMessage.PressedCreate()),
			failure === null ? null : h.text.role("label").tone("danger").children(failureText(failure)),
			h.button
				.label(isSubmitting ? "Creating workspace..." : "Create workspace")
				.loading(isSubmitting)
				.disabled(isSubmitting)
				.on("press", CreateWorkspaceMessage.PressedCreate()),
		)
	},
})
