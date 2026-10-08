import type { UserId } from "@hazel/schema"
import { modifyFields } from "foldkit/struct"
import type { PageReturn } from "../contract"
import { Message } from "./message"
import type { Model } from "./model"

export const init = (userId: UserId): PageReturn<Model, Message> => ({ model: { userId, user: null } })

export const update = (model: Model, message: Message): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		UpdatedProfileUser: ({ user }) => ({ model: modifyFields(model, { user: () => user }) }),
	})
