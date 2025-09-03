import { Repo } from "@automerge/automerge-repo";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import {
	Database,
	type AutomergeDocumentId,
	type DatabaseSchema,
} from "@aicacia/automerge-db";
import { posts } from "./posts";
import { comments } from "./comments";
import { settings } from "./settings";

const databaseDocumentId = localStorage.getItem(
	"database-document-id",
) as AutomergeDocumentId<DatabaseSchema> | null;

export const db = new Database(
	new Repo({
		storage: new IndexedDBStorageAdapter(),
	}),
	{
		databaseDocumentId,
		documents: {
			settings,
		},
		collections: {
			posts,
			comments,
		},
	},
);

db.on("init", (documentId) => {
	localStorage.setItem("database-document-id", documentId);
});

if (!databaseDocumentId) {
	await db.collections.posts.create({
		uri: "test",
		title: "Test",
		content: "This is a test and only a test.",
	});
}
