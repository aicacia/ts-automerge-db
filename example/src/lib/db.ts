import { browser } from "$app/environment";
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

const databaseDocumentId = (
	browser ? localStorage.getItem("database-document-id") : null
) as AutomergeDocumentId<DatabaseSchema> | null;

export const db = new Database(
	new Repo({
		storage: browser ? new IndexedDBStorageAdapter() : undefined,
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

if (browser) {
	db.id().then((dbId) => {
		localStorage.setItem("database-document-id", dbId);
	});
}
