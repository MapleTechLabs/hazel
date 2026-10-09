import { UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { File } from "foldkit/file"
import { calculateInitialCrop, cropImage } from "~/utils/image-crop"
import { detectBrowserTimezone } from "~/utils/timezone"
import { updateUser } from "../user"
import { CropRect } from "./crop"
import { Message } from "./message"
import { FILE_INPUT_ID, FormValues } from "./model"

/** `useUser().user` from `@clerk/react`, read off the shared `window.Clerk` instance. */
interface ClerkUser {
	readonly update: (params: { firstName: string; lastName: string }) => Promise<unknown>
	readonly setProfileImage: (params: { file: Blob | null }) => Promise<unknown>
}

const isClerkUser = (value: unknown): value is ClerkUser =>
	typeof value === "object" &&
	value !== null &&
	"update" in value &&
	typeof value.update === "function" &&
	"setProfileImage" in value &&
	typeof value.setProfileImage === "function"

const clerkUser = (): ClerkUser | null => {
	const clerk: unknown = window.Clerk
	const user = typeof clerk === "object" && clerk !== null && "user" in clerk ? clerk.user : null
	return isClerkUser(user) ? user : null
}

const OUTPUT_SIZE = 512

/** `detectBrowserTimezone()`, the form's fallback timezone, read outside `init` and `update`. */
export const ReadBrowserTimezone = Command.define("ReadProfileBrowserTimezone", {
	messages: [Message.GotBrowserTimezone],
	execute: Effect.sync(() => Message.GotBrowserTimezone({ browserTimezone: detectBrowserTimezone() })),
})

/** FileTrigger: pressing the button clicks the hidden file input. */
export const OpenFilePicker = Command.define("OpenFilePicker", {
	messages: [Message.CompletedOpenFilePicker],
	execute: Effect.sync(() => {
		document.getElementById(FILE_INPUT_ID)?.click()
		return Message.CompletedOpenFilePicker()
	}),
})

const loadImage = (src: string) =>
	Effect.callback<HTMLImageElement, Error>((resume) => {
		const image = new Image()
		image.onload = () => resume(Effect.succeed(image))
		image.onerror = () => resume(Effect.fail(new Error("Failed to load image")))
		image.src = src
	})

/** `AvatarCropModal`'s effect: an object URL for the file, then the largest centered square. */
export const LoadCropImage = Command.define("LoadCropImage", {
	args: { file: File, loadId: Schema.Number },
	messages: [Message.LoadedCropImage, Message.FailedLoadCropImage],
	execute: ({ file, loadId }) => {
		const src = URL.createObjectURL(file)
		return loadImage(src).pipe(
			Effect.map((image) =>
				Message.LoadedCropImage({
					loadId,
					image: {
						src,
						width: image.naturalWidth,
						height: image.naturalHeight,
						crop: calculateInitialCrop(image.naturalWidth, image.naturalHeight),
						drag: null,
					},
				}),
			),
			Effect.catch(() =>
				Effect.sync(() => {
					URL.revokeObjectURL(src)
					return Message.FailedLoadCropImage({ loadId })
				}),
			),
		)
	},
})

export const RevokeCropImage = Command.define("RevokeCropImage", {
	args: { src: Schema.String },
	messages: [Message.CompletedRevokeCropImage],
	execute: ({ src }) =>
		Effect.sync(() => {
			URL.revokeObjectURL(src)
			return Message.CompletedRevokeCropImage()
		}),
})

export const CropAvatarImage = Command.define("CropAvatarImage", {
	args: { src: Schema.String, crop: CropRect },
	messages: [Message.CompletedCropImage],
	execute: ({ src, crop }) =>
		loadImage(src).pipe(
			Effect.flatMap((image) => Effect.tryPromise(() => cropImage(image, crop, OUTPUT_SIZE))),
			Effect.map((blob) => Message.CompletedCropImage({ blob })),
			Effect.catch(() => Effect.succeed(Message.CompletedCropImage({ blob: null }))),
		),
})

/** `useProfilePictureUpload`: Clerk stores the image; the webhook syncs it to Hazel. */
export const UploadAvatar = Command.define("UploadAvatar", {
	args: { blob: Schema.instanceOf(Blob) },
	messages: [Message.CompletedUploadAvatar],
	execute: ({ blob }) =>
		Effect.tryPromise(async () => {
			const user = clerkUser()
			if (user === null) return false
			await user.setProfileImage({
				file: new globalThis.File([blob], "avatar.webp", { type: "image/webp" }),
			})
			return true
		}).pipe(
			Effect.catch(() => Effect.succeed(false)),
			Effect.map((isUploaded) => Message.CompletedUploadAvatar({ isUploaded })),
		),
})

export const ResetAvatar = Command.define("ResetAvatar", {
	messages: [Message.CompletedResetAvatar],
	execute: Effect.tryPromise(async () => {
		const user = clerkUser()
		if (user === null) return false
		await user.setProfileImage({ file: null })
		return true
	}).pipe(
		Effect.catch(() => Effect.succeed(false)),
		Effect.map((isReset) => Message.CompletedResetAvatar({ isReset })),
	),
})

/** The legacy `onSubmit`: the name goes to Clerk, the timezone to `user.update`, both settled. */
export const SaveProfile = Command.define("SaveProfile", {
	args: { userId: UserId, values: FormValues },
	messages: [Message.CompletedSaveProfile],
	execute: ({ userId, values }) =>
		Effect.all(
			[
				Effect.fromNullishOr(clerkUser()).pipe(
					Effect.flatMap((user) =>
						Effect.tryPromise(() =>
							user.update({ firstName: values.firstName, lastName: values.lastName }),
						),
					),
				),
				updateUser({ id: userId, timezone: values.timezone }),
			],
			{ concurrency: "unbounded", mode: "result" },
		).pipe(
			Effect.map((results) =>
				Message.CompletedSaveProfile({
					isSaved: results.every((result) => result._tag === "Success"),
				}),
			),
		),
})
