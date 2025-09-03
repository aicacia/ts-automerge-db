import type { ChangeFn, Repo } from "@automerge/automerge-repo";
import {
	createDocument,
	findDocument,
	type RawDocumentSchema,
	type AutomergeDocumentHandle,
	type AutomergeDocumentId,
	type DocumentSchema,
	type Migrations,
	migrate,
} from "./util/automerge";
import type { Doc } from "@automerge/automerge";
import { MultiError } from "./util/MultiError";
import { Document } from "./Document";
import { createType, type Type } from "./Type";
import { err, ok, type Result } from "./util/result";

export interface RowSchema extends DocumentSchema {
	_collection: string;
}

export type RawRowSchema<R extends RowSchema> = Omit<
	RawDocumentSchema<R>,
	"_collection"
>;

export type CollectionIndex<R extends RowSchema> =
	| keyof R
	| readonly (keyof R)[];

export type CollectionSchemaOptionsIndexes<R extends RowSchema> = Record<
	string,
	CollectionIndex<R>
>;

export interface CollectionSchemaOptions<R extends RowSchema> {
	readonly type: Type<R>;
	readonly indexes: CollectionSchemaOptionsIndexes<R>;
	readonly rowMigrations: Migrations<R>;
}

export type ExtractRowParametersFromIndex<
	R extends RowSchema,
	O extends CollectionSchemaOptions<R>,
	K extends keyof O["indexes"],
> = O["indexes"][K] extends ReadonlyArray<infer AV>
	? ReadonlyArray<R[Extract<AV, keyof R>]>
	: R[Extract<O["indexes"][K], keyof R>];

export interface CollectionIndexSchema<R extends RowSchema> {
	[key: string]: Record<AutomergeDocumentId<R>, true>;
}

export interface CollectionSchema<R extends RowSchema> extends DocumentSchema {
	name: string;
	byId: Record<AutomergeDocumentId<R>, true>;
	indexes: Record<string, AutomergeDocumentId<CollectionIndexSchema<R>>>;
}

export interface CreateCollectionSchemaParameters<R extends RowSchema> {
	readonly indexes?: CollectionSchemaOptionsIndexes<R>;
	readonly rowMigrations?: Migrations<R>;
}

export interface CreateCollectionSchemaOptions<R extends RowSchema> {
	readonly type: Type<R>;
	readonly indexes?: CollectionSchemaOptionsIndexes<R>;
	readonly rowMigrations?: Migrations<R>;
}

export function createCollectionSchema<R extends RowSchema>() {
	return <const I extends CreateCollectionSchemaParameters<R>>(options: I) => ({
		...options,
		type: createType<R>(),
	});
}

export type CollectionFilterFn<R extends RowSchema> = (row: R) => boolean;

export type RowResult<R extends RowSchema> = [
	id: AutomergeDocumentId<R>,
	row: Doc<R>,
];

export class Collection<
	R extends RowSchema,
	C extends CollectionSchema<R>,
	O extends CollectionSchemaOptions<R>,
> extends Document<C> {
	protected repo: Repo;

	protected name: string;
	protected rowMigrations: Migrations<R>;
	protected rowMigrateVersionId: number;

	protected indexes: CollectionSchemaOptionsIndexes<R>;

	constructor(
		repo: Repo,
		documentHandlePromise: Promise<AutomergeDocumentHandle<C>>,
		name: string,
		options: O,
	) {
		super(documentHandlePromise);

		this.repo = repo;
		this.name = name;
		const rowMigrationVersionId = Math.max(
			...Object.keys(options.rowMigrations).map(Number.parseInt),
		);
		this.rowMigrateVersionId =
			rowMigrationVersionId >= Number.POSITIVE_INFINITY ||
			rowMigrationVersionId <= Number.NEGATIVE_INFINITY ||
			Number.isNaN(rowMigrationVersionId)
				? 0
				: rowMigrationVersionId;
		this.rowMigrations = options.rowMigrations ?? {};

		this.indexes = options.indexes;
	}

	async findById(rowId: AutomergeDocumentId<R>) {
		const rowHandle = await findDocument(this.repo, rowId);
		this.migrateRow(rowHandle);
		return rowHandle;
	}

	async find(
		filterFn?: CollectionFilterFn<R>,
		limit = Number.POSITIVE_INFINITY,
		offset = 0,
	): Promise<Result<RowResult<R>[], MultiError>> {
		const useFilterFn = filterFn != null;

		const startOffset = offset * limit;
		const endOffset = startOffset + limit - 1;
		const useStartAndEnd =
			!Number.isNaN(startOffset) && !Number.isNaN(endOffset);

		const documentHandle = await this.documentHandlePromise;
		const collection = documentHandle.doc() as Doc<C>;

		let rowIds = Object.keys(collection.byId) as AutomergeDocumentId<R>[];

		if (!useFilterFn && useStartAndEnd) {
			rowIds = rowIds.slice(startOffset, endOffset);
		}

		let rows: RowResult<R>[] = [];
		const errors: Error[] = [];
		await Promise.all(
			rowIds.map(async (rowId) => {
				let rowHandle: AutomergeDocumentHandle<R>;
				try {
					rowHandle = await findDocument(this.repo, rowId);
				} catch (error) {
					errors.push(error as Error);
					return;
				}

				this.migrateRow(rowHandle);

				if (useFilterFn) {
					if (!filterFn(rowHandle.doc())) {
						return;
					}
				}

				rows.push([rowHandle.documentId, rowHandle.doc()]);
			}),
		);

		if (useStartAndEnd) {
			rows = rows.slice(startOffset, endOffset);
		}

		if (errors.length) {
			return err(new MultiError(errors));
		}

		return ok(rows);
	}

	async findByIndex<
		const K extends Extract<keyof O["indexes"], string>,
		const V extends ExtractRowParametersFromIndex<R, O, K>,
	>(indexName: K, values: V): Promise<Result<RowResult<R>[], MultiError>> {
		const collectionHandle = await this.documentHandlePromise;
		const indexDocuments = await this.getIndexesForCollection(
			collectionHandle,
			[indexName],
		);

		const rows: RowResult<R>[] = [];
		const errors: Error[] = [];

		const indexDocument = indexDocuments[indexName];
		if (indexDocument) {
			const index = indexDocument.doc() as CollectionIndexSchema<R>;
			const indexValue = this.getIndexForValues(values);
			const rowIds = Object.keys(
				index[indexValue] ?? {},
			) as AutomergeDocumentId<R>[];

			if (rowIds.length > 0) {
				await Promise.all(
					rowIds.map(async (rowId) => {
						let rowHandle: AutomergeDocumentHandle<R>;
						try {
							rowHandle = await findDocument(this.repo, rowId);
						} catch (error) {
							errors.push(error as Error);
							return;
						}

						this.migrateRow(rowHandle);

						rows.push([rowHandle.documentId, rowHandle.doc()]);
					}),
				);
			}
		}

		if (errors.length) {
			return err(new MultiError(errors));
		}

		return ok(rows);
	}

	async create(initialValue: RawRowSchema<R>) {
		const rowInitialValue = {
			...initialValue,
			_mvid: this.rowMigrateVersionId,
			_collection: this.name,
		} as R;
		const rowHandle = createDocument(
			this.repo,
			rowInitialValue,
		) as AutomergeDocumentHandle<R>;

		const row = rowHandle.doc();
		const documentHandle = await this.documentHandlePromise;
		documentHandle.change((collection: C) => {
			collection.byId[rowHandle.documentId] = true;
		});
		await this.createIndexesForRow(documentHandle, rowHandle.documentId, row);

		await this.repo.flush([rowHandle.documentId, documentHandle.documentId]);

		return [rowHandle.documentId, rowHandle.doc()] as RowResult<R>;
	}

	async update(
		rowId: AutomergeDocumentId<R>,
		changeFn: ChangeFn<RawRowSchema<R>>,
	) {
		const rowHandle = await findDocument(this.repo, rowId);

		let promise = Promise.resolve();
		rowHandle.change((row: R) => {
			const previousIndexes = this.getIndexesForRow(row);
			changeFn(row);
			const currentIndexes = this.getIndexesForRow(row);
			const { newIndexes, deletedIndexes } = indexChanges(
				previousIndexes,
				currentIndexes,
			);
			const rowIndexKeys = Array.from(
				new Set(Object.keys(newIndexes).concat(Object.keys(deletedIndexes))),
			);

			if (rowIndexKeys.length) {
				promise = this.documentHandlePromise
					.then((documentHandle) =>
						this.getIndexesForCollection(documentHandle, rowIndexKeys),
					)
					.then((indexDocuments) => {
						this.deleteIndexes(indexDocuments, deletedIndexes, rowId);
						return this.setIndexes(rowId, indexDocuments, newIndexes);
					});
			}
		});

		await promise;

		return [rowHandle.documentId, rowHandle.doc()] as RowResult<R>;
	}

	async delete(rowId: AutomergeDocumentId<R>) {
		const rowHandle = await findDocument(this.repo, rowId);

		const row = rowHandle.doc();
		const indexes = this.getIndexesForRow(row);
		const rowIndexKeys = Object.keys(indexes);

		if (rowIndexKeys.length) {
			const documentHandle = await this.documentHandlePromise;
			const indexDocuments = await this.getIndexesForCollection(
				documentHandle,
				rowIndexKeys,
			);
			this.deleteIndexes(indexDocuments, indexes, rowHandle.documentId);
		}

		rowHandle.delete();
	}

	private migrateRow(row: AutomergeDocumentHandle<R>) {
		return migrate(row, this.rowMigrations);
	}

	private getIndexesForRow(row: R) {
		const indexes = {} as Record<string, string>;

		outer: for (const [name, key] of Object.entries(this.indexes)) {
			let index = null;

			if (Array.isArray(key)) {
				const keys: Array<keyof R> = key;

				for (let i = 0; i < keys.length; i++) {
					const rowKey = keys[i];
					const rowKeyValue = row[rowKey];
					// TODO: handle nulls in indexes
					if (rowKeyValue === null) {
						continue outer;
					}
					if (index === null) {
						index = JSON.stringify(rowKeyValue);
					} else {
						index += JSON.stringify(rowKeyValue);
					}
					if (i < keys.length - 1) {
						index += "|";
					}
				}
			} else {
				const rowKey = key as keyof R;
				const rowKeyValue = row[rowKey];
				if (rowKeyValue === null) {
					continue;
				}
				index = JSON.stringify(rowKeyValue);
			}
			if (index !== null) {
				const indexName = name as string;
				indexes[indexName] = index;
			}
		}

		return indexes;
	}

	private getIndexForValues<K extends keyof R>(
		values: R[K] | readonly R[K][],
	): string {
		if (Array.isArray(values) && values.length > 0) {
			let index: string | null = null;

			for (let i = 0; i < values.length; i++) {
				const value = values[i];
				if (index === null) {
					index = JSON.stringify(value);
				} else {
					index += JSON.stringify(value);
				}
				if (i < values.length - 1) {
					index += "|";
				}
			}

			return index as string;
		}
		return JSON.stringify(values);
	}

	private async getIndexesForCollection(
		collectionHandle: AutomergeDocumentHandle<C>,
		names: string[],
	) {
		const indexDocuments = {} as Record<
			string,
			AutomergeDocumentHandle<CollectionIndexSchema<R>>
		>;

		const collection = collectionHandle.doc();
		await Promise.all(
			names.map(async (name) => {
				const indexDocumentId = collection.indexes[name];

				if (indexDocumentId) {
					indexDocuments[name] = await findDocument(this.repo, indexDocumentId);
				} else {
					const indexDocument = createDocument(
						this.repo,
						{} as CollectionIndexSchema<R>,
					);
					indexDocuments[name] = indexDocument;
					collectionHandle.change((collection: C) => {
						collection.indexes[name] = indexDocument.documentId;
					});
				}
			}),
		);

		return indexDocuments;
	}

	private async createIndexesForRow(
		collectionHandle: AutomergeDocumentHandle<C>,
		rowId: AutomergeDocumentId<R>,
		row: R,
	) {
		const rowIndexes = this.getIndexesForRow(row);
		const rowIndexKeys = Object.keys(rowIndexes);

		if (rowIndexKeys.length > 0) {
			const indexDocuments = await this.getIndexesForCollection(
				collectionHandle,
				rowIndexKeys,
			);

			await this.setIndexes(rowId, indexDocuments, rowIndexes);
		}
	}

	private async setIndexes(
		rowId: AutomergeDocumentId<R>,
		indexDocuments: Record<
			string,
			AutomergeDocumentHandle<CollectionIndexSchema<R>>
		>,
		rowIndexes: Record<string, string>,
	) {
		for (const k of Object.keys(rowIndexes)) {
			const key = k as string;
			const indexDocument = indexDocuments[key];
			const rowIndex = rowIndexes[key];

			indexDocument.change((index: CollectionIndexSchema<R>) => {
				if (!index[rowIndex]) {
					index[rowIndex] = {};
				}
				index[rowIndex][rowId] = true;
			});
			await this.repo.flush([indexDocument.documentId]);
		}
	}

	private deleteIndexes(
		indexDocuments: Record<
			string,
			AutomergeDocumentHandle<CollectionIndexSchema<R>>
		>,
		rowIndexes: Record<string, string>,
		rowId: AutomergeDocumentId<R>,
	) {
		for (const k of Object.keys(rowIndexes)) {
			const key = k as string;
			const indexDocument = indexDocuments[key];
			const rowIndex = rowIndexes[key];

			indexDocument.change((index: CollectionIndexSchema<R>) => {
				const indexIds = index[rowIndex];
				if (indexIds) {
					delete indexIds[rowId];
				}
			});
		}
	}
}

function indexChanges(
	previous: Record<string, string>,
	next: Record<string, string>,
): {
	newIndexes: Record<string, string>;
	deletedIndexes: Record<string, string>;
} {
	const newIndexes: Record<string, string> = {};
	const deletedIndexes: Record<string, string> = {};

	for (const indexName of new Set(
		Object.keys(previous).concat(Object.keys(next)),
	)) {
		const previousIndex = previous[indexName];
		const nextIndex = next[indexName];

		if (previousIndex == null) {
			if (nextIndex == null) {
				continue;
			}
			newIndexes[indexName] = nextIndex;
		} else {
			if (nextIndex == null) {
				deletedIndexes[indexName] = previousIndex;
				continue;
			}
			if (previousIndex !== nextIndex) {
				deletedIndexes[indexName] = previousIndex;
				newIndexes[indexName] = nextIndex;
			}
		}
	}

	return { newIndexes, deletedIndexes };
}
