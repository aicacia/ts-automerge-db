import { createCollectionSchema, type RowSchema } from "@aicacia/automerge-db";
import { createType } from "../../../types/Type";

export interface Comment extends RowSchema {
	content: string;
}

export const comments = createCollectionSchema(createType<Comment>(), {});
