import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { closed } from "../out-message"
import { defineModal, type ModalViewInputs } from "./contract"

/** Stub for legacy `components/modals/rename-channel-modal.tsx`: closes at once until it is ported. */

const Model = Schema.Struct({})
const Message = defineMessageUnion({ ClickedClose: {} })

export const modal = defineModal(
	"RenameChannel",
	{ request: { channelId: ChannelId }, Model, Message },
	{
		init: () => ({ model: {}, outMessage: closed }),
		update: (model) => ({ model, outMessage: closed }),
		view: Submodel.defineView<typeof Model.Type, typeof Message.Type, ModalViewInputs>((_model, _inputs, h) => h.empty),
	},
)
