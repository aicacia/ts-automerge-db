import { createCollectionSchema, type RowSchema } from "@aicacia/automerge-db";
import { createType } from "../../../types/Type";

export interface Post extends RowSchema {
	uri: string;
	title: string;
	content: string;
}

export const posts = createCollectionSchema(createType<Post>(), {
	indexes: {
		uri: "uri",
	},
});
