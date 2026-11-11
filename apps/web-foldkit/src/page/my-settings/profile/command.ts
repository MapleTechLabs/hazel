import { UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { File } from "foldkit/file"
import { catchCommon } from "../../../data/actions"
import { calculateInitialCrop, cropImage, loadImage } from "~/utils/image-crop"
import { detectBrowserTimezone } from "~/utils/timezone"
import { UploadTarget, uploadFile } from "../../settings/upload"
import { settleUpdateUser, updateUser } from "../user"
import { CropRect } from "./crop"
import { Message } from "./message"
import { FILE_INPUT_ID, FormValues } from "./model"

const OUTPUT_SIZE = 512

/** `detectBrowserTimezone()`, the form's fallback timezone, read outside `init` and `update`. */
export const ReadProfileBrowserTimezone = Command.define("ReadProfileBrowserTimezone", {
	messages: [Message.DetectedBrowserTimezone],
	execute: Effect.sync(() => Message.DetectedBrowserTimezone({ browserTimezone: detectBrowserTimezone() })),
})

/** FileTrigger: pressing the button clicks the hidden file input. */
export const OpenFilePicker = Command.define("OpenFilePicker", {
	messages: [Message.CompletedOpenFilePicker],
	execute: Effect.sync(() => {
		document.getElementById(FILE_INPUT_ID)?.click()
		return Message.CompletedOpenFilePicker()
	}),
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
			Effect.catchTags({
				CropError: ({ reason }) =>
					Effect.sync(() => {
						URL.revokeObjectURL(src)
						return Message.FailedLoadCropImage({ loadId, reason })
					}),
			}),
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
	messages: [Message.SucceededCropImage, Message.FailedCropImage],
	execute: ({ src, crop }) =>
		loadImage(src).pipe(
			Effect.flatMap((image) => cropImage(image, crop, OUTPUT_SIZE)),
			Effect.map((blob) => Message.SucceededCropImage({ blob })),
			Effect.catchTags({
				CropError: ({ reason }) => Effect.succeed(Message.FailedCropImage({ reason })),
			}),
		),
})

/** `useProfilePictureUpload`: upload the cropped image, then point the user's avatar at it. */
export const UploadAvatar = Command.define("UploadAvatar", {
	args: { userId: UserId, blob: Schema.instanceOf(Blob) },
	messages: [Message.SucceededUploadAvatar, Message.FailedUploadAvatar],
	execute: ({ userId, blob }) =>
		Effect.gen(function* () {
			const file = new globalThis.File([blob], "avatar.webp", { type: "image/webp" })
			const avatarUrl = yield* uploadFile(UploadTarget.UserAvatar(), file)
			yield* updateUser({ id: userId, avatarUrl })
			return Message.SucceededUploadAvatar()
		}).pipe(
			Effect.catchTags({
				UploadFailedError: ({ problem }) =>
					Effect.succeed(Message.FailedUploadAvatar({ reason: problem })),
				UserNotFoundError: () =>
					Effect.succeed(Message.FailedUploadAvatar({ reason: "UserNotFound" })),
			}),
			catchCommon((reason) => Message.FailedUploadAvatar({ reason })),
		),
})

export const ResetAvatar = Command.define("ResetAvatar", {
	args: { userId: UserId },
	messages: [Message.SucceededResetAvatar, Message.FailedResetAvatar],
	execute: ({ userId }) =>
		settleUpdateUser(
			updateUser({ id: userId, avatarUrl: null }),
			Message.SucceededResetAvatar(),
			(reason) => Message.FailedResetAvatar({ reason }),
		),
})

/** The legacy `onSubmit`: name and timezone in one `user.update`. */
export const SaveProfile = Command.define("SaveProfile", {
	args: { userId: UserId, values: FormValues },
	messages: [Message.SucceededSaveProfile, Message.FailedSaveProfile],
	execute: ({ userId, values }) =>
		settleUpdateUser(
			updateUser({
				id: userId,
				firstName: values.firstName,
				lastName: values.lastName,
				timezone: values.timezone,
			}),
			Message.SucceededSaveProfile({ values }),
			(reason) => Message.FailedSaveProfile({ reason }),
		),
})
