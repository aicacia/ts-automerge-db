import type { Repo } from "@automerge/automerge-repo";
import {
	type Migrations,
	type AutomergeDocumentId,
	type DocumentSchema,
	type AutomergeDocumentHandle,
	initOrCreateDocument,
} from "./util";
import {
	Document,
	initOrCreateDocumentHandle,
	type CreateDocumentSchemaOptions,
} from "./Document";
import {
	Collection,
	type CreateCollectionSchemaOptions,
	type CollectionIndex,
	type CollectionSchema,
	type CollectionSchemaOptions,
	type RowSchema,
	type CollectionSchemaOptionsIndexes,
	initOrCreateCollectionHandle,
} from "./Collection";
import type { Doc } from "@automerge/automerge";
import { isPromiseLike, type MaybePromiseLike } from "@aicacia/trycatch";

export interface DatabaseSchema extends DocumentSchema {
	documents: Record<string, AutomergeDocumentId>;
	collections: Record<string, AutomergeDocumentId>;
}

export type ExtractDocument<O> = O extends CreateDocumentSchemaOptions<infer D>
	? Document<D>
	: unknown;

export type ExtractDocuments<Documents extends { [name: string]: unknown }> = {
	[Name in keyof Documents]: ExtractDocument<Documents[Name]>;
};

export type ExtractCollectionSchema<O> =
	O extends CreateCollectionSchemaOptions<infer R>
		? CollectionSchema<R> & {
				indexes: {
					[IndexName in keyof O["indexes"]]: CollectionIndex<R>;
				};
			}
		: unknown;

export type ExtractCollection<O> = O extends CreateCollectionSchemaOptions<
	infer R
>
	? Collection<R, ExtractCollectionSchema<O>, CollectionSchemaOptions<R>>
	: unknown;

export type ExtractCollections<
	Collections extends { [name: string]: unknown },
> = {
	[Name in keyof Collections]: ExtractCollection<Collections[Name]>;
};

const databaseMigrations: Migrations<DatabaseSchema> = {
	1(database: DatabaseSchema) {
		database.documents = {};
		database.collections = {};
	},
};

export interface DatabaseOptions<Documents, Collections> {
	readonly databaseDocumentId?: MaybePromiseLike<AutomergeDocumentId<DatabaseSchema> | null>;
	readonly documents: Documents;
	readonly collections: Collections;
}

export class Database<
	Documents extends { [name: string]: unknown },
	Collections extends {
		[name: string]: unknown;
	},
> {
	protected databaseDocumentHandlePromise: PromiseLike<
		AutomergeDocumentHandle<DatabaseSchema>
	>;

	readonly repo: Repo;

	readonly documents: ExtractDocuments<Documents>;
	readonly collections: ExtractCollections<Collections>;

	constructor(repo: Repo, options: DatabaseOptions<Documents, Collections>) {
		this.databaseDocumentHandlePromise = (
			isPromiseLike(options.databaseDocumentId)
				? options.databaseDocumentId
				: Promise.resolve(options.databaseDocumentId)
		).then((databaseDocumentId) =>
			initOrCreateDocument(repo, databaseMigrations, databaseDocumentId),
		);
		this.repo = repo;
		this.documents = Object.fromEntries(
			(
				Object.entries(options.documents) as [
					name: string,
					documentOptions: CreateDocumentSchemaOptions<DocumentSchema>,
				][]
			).map(([name, documentOptions]) => [
				name,
				this.createDocument(name, documentOptions.migrations ?? {}),
			]),
		) as ExtractDocuments<Documents>;
		this.collections = Object.fromEntries(
			(
				Object.entries(options.collections) as [
					name: string,
					collectionOptions: CreateCollectionSchemaOptions<RowSchema>,
				][]
			).map(([name, collectionOptions]) => [
				name,
				this.createCollection(name, collectionOptions),
			]),
		) as ExtractCollections<Collections>;
	}

	async id() {
		const documentHandle = await this.databaseDocumentHandlePromise;
		return documentHandle.documentId as AutomergeDocumentId<DatabaseSchema>;
	}

	private async initOrCreateDocumentHandle<D extends DocumentSchema>(
		name: string,
		migrations: Migrations<D>,
	) {
		const databaseDocumentHandle = await this.databaseDocumentHandlePromise;
		const database = databaseDocumentHandle.doc() as Doc<DatabaseSchema>;
		const documentId = database.documents[name] as
			| AutomergeDocumentId<D>
			| undefined;

		const documentIds = [] as AutomergeDocumentId[];

		const [documentHandle, shouldFlushDocument] =
			await initOrCreateDocumentHandle<D>(this.repo, migrations, documentId);

		if (!documentId) {
			databaseDocumentHandle.change((database: DatabaseSchema) => {
				database.documents[name] = documentHandle.documentId;
			});
			documentIds.push(databaseDocumentHandle.documentId);
		}
		if (shouldFlushDocument) {
			documentIds.push(documentHandle.documentId);
		}

		await this.repo.flush(documentIds);

		return documentHandle;
	}

	private createDocument<D extends DocumentSchema>(
		name: string,
		migrations: Migrations<D>,
	) {
		return new Document(this.initOrCreateDocumentHandle(name, migrations));
	}

	private async initOrCreateCollectionHandle<
		R extends RowSchema,
		C extends CollectionSchema<R>,
		I extends CollectionSchemaOptionsIndexes<R>,
	>(name: string, indexes: I) {
		const databaseDocumentHandle = await this.databaseDocumentHandlePromise;
		const database = databaseDocumentHandle.doc() as Doc<DatabaseSchema>;
		const collectionDocumentId = database.collections[name] as
			| AutomergeDocumentId<C>
			| undefined;

		const documentIds = [] as AutomergeDocumentId[];

		const [collectionDocumentHandle, shouldFlushDocument] =
			await initOrCreateCollectionHandle<R, C, I>(
				this.repo,
				indexes,
				collectionDocumentId,
			);

		if (!collectionDocumentId) {
			databaseDocumentHandle.change((database: DatabaseSchema) => {
				database.collections[name] = collectionDocumentHandle.documentId;
			});
			documentIds.push(databaseDocumentHandle.documentId);
		}
		if (shouldFlushDocument) {
			documentIds.push(collectionDocumentHandle.documentId);
		}

		await this.repo.flush(documentIds);

		return collectionDocumentHandle;
	}

	private createCollection<
		R extends RowSchema,
		C extends CollectionSchema<R>,
		O extends CreateCollectionSchemaOptions<R>,
	>(name: string, options: O) {
		const collectionOptions = {
			type: options.type,
			indexes: options.indexes ?? {},
			rowMigrations: options.rowMigrations ?? {},
		} satisfies CollectionSchemaOptions<R>;
		type CollectionOptions = typeof collectionOptions;

		return new Collection<R, C, CollectionOptions>(
			this.initOrCreateCollectionHandle<R, C, CollectionOptions["indexes"]>(
				name,
				collectionOptions.indexes,
			),
			this.repo,
			name,
			collectionOptions,
		);
	}
}
