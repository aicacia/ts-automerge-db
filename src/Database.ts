import type { Repo } from "@automerge/automerge-repo";
import {
	initOrCreateDocument,
	type Migrations,
	type AutomergeDocumentId,
	type DocumentSchema,
	createDocument,
	findDocument,
	migrate,
	type AutomergeDocumentHandle,
} from "./util";
import { Document, type CreateDocumentSchemaOptions } from "./Document";
import {
	Collection,
	type CreateCollectionSchemaOptions,
	type CollectionSchema,
	type CollectionSchemaOptions,
	type RowSchema,
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
				indexes: { [indexName in keyof O["indexes"]]: AutomergeDocumentId<R> };
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
> extends Document<DatabaseSchema> {
	readonly repo: Repo;

	readonly documents: ExtractDocuments<Documents>;
	readonly collections: ExtractCollections<Collections>;

	constructor(repo: Repo, options: DatabaseOptions<Documents, Collections>) {
		super(
			(isPromiseLike(options.databaseDocumentId)
				? options.databaseDocumentId
				: Promise.resolve(options.databaseDocumentId)
			).then((databaseDocumentId) =>
				initOrCreateDocument(repo, databaseMigrations, databaseDocumentId),
			),
		);
		this.repo = repo;
		// @ts-ignore
		this.documents = Object.fromEntries(
			// @ts-ignore
			Object.entries(options.documents).map(([name, documentOptions]) =>
				// @ts-ignore
				[name, this.createDocument(name, documentOptions.migrations ?? {})],
			),
		);
		// @ts-ignore
		this.collections = Object.fromEntries(
			// @ts-ignore
			Object.entries(options.collections).map(([name, collectionOptions]) =>
				// @ts-ignore
				[name, this.createCollection(name, collectionOptions)],
			),
		);
	}

	private async initOrCreateDocumentHandle<D extends DocumentSchema>(
		name: string,
		migrations: Migrations<D>,
	) {
		const databaseHandle = await this.documentHandlePromise;
		const database = databaseHandle.doc() as Doc<DatabaseSchema>;
		let documentId = database.documents[name] as
			| AutomergeDocumentId<D>
			| undefined;
		let documentHandle: AutomergeDocumentHandle<D>;

		const documentIds = [] as AutomergeDocumentId[];

		if (!documentId) {
			documentHandle = createDocument<D>(this.repo, {
				_mvid: -1,
			} as D);
			documentId = documentHandle.documentId;
			databaseHandle.change((doc: DatabaseSchema) => {
				doc.documents[name] = documentHandle.documentId;
			});
			documentIds.push(databaseHandle.documentId);
		} else {
			documentHandle = await findDocument(this.repo, documentId);
		}

		if (migrate(documentHandle, migrations)) {
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
	>(name: string, migrations: Migrations<C>) {
		const databaseHandle = await this.documentHandlePromise;
		const database = databaseHandle.doc() as Doc<DatabaseSchema>;
		let documentId = database.collections[name] as
			| AutomergeDocumentId<C>
			| undefined;
		let documentHandle: AutomergeDocumentHandle<C>;

		const documentIds = [] as AutomergeDocumentId[];

		if (!documentId) {
			documentHandle = createDocument<C>(this.repo, {
				_mvid: -1,
				byId: {},
				indexes: {},
			} as C);
			documentId = documentHandle.documentId;
			databaseHandle.change((doc: DatabaseSchema) => {
				doc.collections[name] = documentHandle.documentId;
			});
			documentIds.push(databaseHandle.documentId);
		} else {
			documentHandle = await findDocument(this.repo, documentId);
		}

		if (migrate(documentHandle, migrations)) {
			documentIds.push(documentHandle.documentId);
		}
		await this.repo.flush(documentIds);

		return documentHandle;
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

		return new Collection<R, C, typeof collectionOptions>(
			this.repo,
			this.initOrCreateCollectionHandle(name, {}),
			name,
			collectionOptions,
		);
	}
}
