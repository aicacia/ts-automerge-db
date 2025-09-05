import { createCollectionSchema, type RowSchema } from "@aicacia/automerge-db";

export interface Comment extends RowSchema {
	content: string;
}

export const comments = createCollectionSchema<Comment>()({});
