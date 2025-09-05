import { createCollectionSchema, type RowSchema } from "@aicacia/automerge-db";

export interface Post extends RowSchema {
	uri: string;
	title: string;
	content: string;
	createdAt: number;
}

export const posts = createCollectionSchema<Post>()({
	indexes: {
		uri: "uri",
	},
});
