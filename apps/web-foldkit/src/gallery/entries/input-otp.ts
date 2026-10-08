import { Option, Schema } from "effect"
import { Subscription, Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as InputOtp from "../../ui/input-otp"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const OtpKey = Schema.Literals(["code", "pin", "disabled"])
type OtpKey = typeof OtpKey.Type

const Model = Schema.Struct({ code: InputOtp.Model, pin: InputOtp.Model, disabled: InputOtp.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotInputOtpMessage: { otp: OtpKey, message: InputOtp.Message },
})
type Message = typeof Message.Type

const toOtpMessage =
	(otp: OtpKey) =>
	(message: InputOtp.Message): Message =>
		Message.GotInputOtpMessage({ otp, message })

// INIT

const init = (): Update.Return<Model, Message> =>
	Update.foldChildInits(
		{
			code: InputOtp.init({ id: "otp-code", maxLength: 6 }),
			pin: InputOtp.init({ id: "otp-pin", maxLength: 4, value: "42" }),
			disabled: InputOtp.init({ id: "otp-disabled", maxLength: 4, value: "1234", isDisabled: true }),
		},
		{
			toParentModel: ({ code, pin, disabled }): Model => ({ code, pin, disabled }),
			folds: {
				code: { toParentMessage: toOtpMessage("code") },
				pin: { toParentMessage: toOtpMessage("pin") },
				disabled: { toParentMessage: toOtpMessage("disabled") },
			},
		},
	)

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotInputOtpMessage: ({ otp, message }) =>
			Update.foldChild({
				update: InputOtp.update,
				read: (current: Model) => Option.some(current[otp]),
				write: (current: Model, next: InputOtp.Model): Model => ({ ...current, [otp]: next }),
				toParentMessage: toOtpMessage(otp),
			})(model, message),
	})

const liftOtp = (otp: OtpKey) =>
	Subscription.lift(InputOtp.subscriptions)<Model, Message>({
		read: (model) => Option.some(model[otp]),
		toParentMessage: toOtpMessage(otp),
	}).selection

const subscriptions = Subscription.aggregate<Model, Message>()(
	{ codeSelection: liftOtp("code") },
	{ pinSelection: liftOtp("pin") },
	{ disabledSelection: liftOtp("disabled") },
)

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const otp = (
		key: OtpKey,
		ariaLabel: string,
		slots: (parts: InputOtp.InputOtpParts) => ReturnType<typeof h.div>[],
	) => InputOtp.inputOtp(h, { model: model[key], toParentMessage: toOtpMessage(key), ariaLabel }, slots)
	return galleryFrame(h, "Input OTP", [
		gallerySection(h, "Six digits", [
			otp("code", "Verification code", (parts) => [
				parts.group([parts.slot(0), parts.slot(1), parts.slot(2)]),
				parts.separator(),
				parts.group([parts.slot(3), parts.slot(4), parts.slot(5)]),
			]),
		]),
		gallerySection(h, "Prefilled", [
			otp("pin", "PIN", (parts) => [parts.group([0, 1, 2, 3].map((index) => parts.slot(index)))]),
		]),
		gallerySection(h, "Disabled", [
			otp("disabled", "Disabled code", (parts) => [
				parts.group([0, 1, 2, 3].map((index) => parts.slot(index))),
			]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Input OTP", {
	Model,
	init,
	update,
	view,
	subscriptions,
})
