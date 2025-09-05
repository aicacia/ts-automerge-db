import type { Doc, ChangeFn } from "@automerge/automerge";
import type { DocHandleChangePayload, Repo } from "@automerge/automerge-repo";
import {
	createDocument,
	findDocument,
	type RawDocumentSchema,
	type AutomergeDocumentHandle,
	type AutomergeDocumentId,
	type DocumentSchema,
	type Migrations,
	migrate,
	findDocumentCurrent,
} from "./util/automerge";
import { MultiError } from "./util/MultiError";
import { createType, type Type } from "./Type";
import { err, ok, type Result } from "@aicacia/trycatch";

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
	byId: Record<AutomergeDocumentId<R>, number>;
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
	const type = createType<R>();

	return <const I extends CreateCollectionSchemaParameters<R>>(options: I) => ({
		...options,
		type,
	});
}

export interface CollectionFilterOptions<R extends RowSchema> {
	filter?(row: R): boolean;
	sort?(a: R, b: R): number;
	limit?: number;
	offset?: number;
}

export interface CollectionEventCreate<R> {
	type: "create";
	id: AutomergeDocumentId<R>;
	row: Doc<R>;
}

export interface CollectionEventUpdate<R> {
	type: "update";
	id: AutomergeDocumentId<R>;
	row: Doc<R>;
}

export interface CollectionEventDelete<R> {
	type: "delete";
	id: AutomergeDocumentId<R>;
}

export type CollectionEvent<R> =
	| CollectionEventCreate<R>
	| CollectionEventUpdate<R>
	| CollectionEventDelete<R>;

export type CollectionSubscriber<R extends RowSchema> = (
	event: CollectionEvent<R>,
) => void;

export type RowResult<R extends RowSchema> = [
	id: AutomergeDocumentId<R>,
	row: Doc<R>,
];

export class Collection<
	R extends RowSchema,
	C extends CollectionSchema<R>,
	O extends CollectionSchemaOptions<R>,
> {
	protected repo: Repo;
	protected collectionDocumentHandlePromise: PromiseLike<
		AutomergeDocumentHandle<C>
	>;

	protected name: string;
	protected rowMigrations: Migrations<R>;
	protected rowMigrateVersionId: number;

	protected indexes: CollectionSchemaOptionsIndexes<R>;

	constructor(
		collectionDocumentHandlePromise: PromiseLike<AutomergeDocumentHandle<C>>,
		repo: Repo,
		name: string,
		options: O,
	) {
		this.collectionDocumentHandlePromise = collectionDocumentHandlePromise;
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

	subscribe(callback: CollectionSubscriber<R>) {
		const repo = this.repo;

		async function onCollectionDocumentChange(
			payload: DocHandleChangePayload<C>,
		) {
			for (const patch of payload.patches) {
				switch (patch.action) {
					case "put": {
						const [byId, rowId] = patch.path;

						if (byId === "byId") {
							callback({
								type: patch.value === 0 ? "create" : "update",
								id: rowId,
								row: await findDocumentCurrent(repo, rowId),
							});
						}
						break;
					}
					case "del": {
						const [byId, rowId] = patch.path;

						if (byId === "byId") {
							callback({
								type: "delete",
								id: rowId,
							});
						}
						break;
					}
					default: {
						break;
					}
				}
			}
		}

		const collectionDocumentHandlePromise =
			this.collectionDocumentHandlePromise.then((collectionDocumentHandle) => {
				collectionDocumentHandle.on("change", onCollectionDocumentChange);
				return collectionDocumentHandle;
			});

		return () => {
			collectionDocumentHandlePromise.then((collectionDocumentHandle) => {
				collectionDocumentHandle.off("change", onCollectionDocumentChange);
			});
		};
	}

	async findById(rowId: AutomergeDocumentId<R>) {
		const collectionDocumentHandle = await this.collectionDocumentHandlePromise;
		const collection = collectionDocumentHandle.doc() as Doc<C>;

		if (!collection.byId[rowId]) {
			throw new Error(`Document ${rowId} is unavailable`);
		}

		const rowHandle = await findDocument(this.repo, rowId);
		this.migrateRow(rowHandle);
		return rowHandle;
	}

	async find(
		filterOptions: CollectionFilterOptions<R> = {},
	): Promise<Result<RowResult<R>[], MultiError>> {
		const collectionDocumentHandle = await this.collectionDocumentHandlePromise;
		const collection = collectionDocumentHandle.doc() as Doc<C>;
		const rowIds = Object.keys(collection.byId) as AutomergeDocumentId<R>[];

		return this.filterRowIds(rowIds, filterOptions);
	}

	async findByIndex<
		const K extends Extract<keyof O["indexes"], string>,
		const V extends ExtractRowParametersFromIndex<R, O, K>,
	>(
		indexName: K,
		values: V,
		options: CollectionFilterOptions<R> = {},
	): Promise<Result<RowResult<R>[], MultiError>> {
		const collectionHandle = await this.collectionDocumentHandlePromise;
		const [indexDocuments, shouldFlushCollectionDocument] =
			await this.getIndexesForCollection(collectionHandle, [indexName]);

		if (shouldFlushCollectionDocument) {
			await this.repo.flush([collectionHandle.documentId]);
		}

		const indexDocument = indexDocuments[indexName];
		if (indexDocument) {
			const index = indexDocument.doc() as CollectionIndexSchema<R>;
			const indexValue = this.getIndexForValues(values);
			const rowIds = Object.keys(
				index[indexValue] ?? {},
			) as AutomergeDocumentId<R>[];

			return this.filterRowIds(rowIds, options);
		}

		return ok([]);
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
		const collectionDocumentHandle = await this.collectionDocumentHandlePromise;
		collectionDocumentHandle.change((collection: C) => {
			collection.byId[rowHandle.documentId] = 0;
		});

		const flushDocumentIds = [
			rowHandle.documentId,
			collectionDocumentHandle.documentId,
		] as AutomergeDocumentId[];

		const rowIndexes = this.getIndexesForRow(row);
		const rowIndexKeys = Object.keys(rowIndexes);

		if (rowIndexKeys.length > 0) {
			const [indexDocuments, _shouldFlushCollectionDocument] =
				await this.getIndexesForCollection(
					collectionDocumentHandle,
					rowIndexKeys,
				);

			this.setIndexes(rowHandle.documentId, indexDocuments, rowIndexes);

			flushDocumentIds.push(
				...Object.values(indexDocuments).map(
					(indexDocument) => indexDocument.documentId,
				),
			);
		}

		await this.repo.flush(flushDocumentIds);

		return [rowHandle.documentId, rowHandle.doc()] as RowResult<R>;
	}

	async update(
		rowId: AutomergeDocumentId<R>,
		changeFn: ChangeFn<RawRowSchema<R>>,
	) {
		const collectionDocumentHandle = await this.collectionDocumentHandlePromise;
		const rowHandle = await findDocument(this.repo, rowId);

		const flushDocumentIds = [
			rowHandle.documentId,
			collectionDocumentHandle.documentId,
		] as AutomergeDocumentId[];

		let promise: PromiseLike<void> = Promise.resolve();
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
				promise = this.getIndexesForCollection(
					collectionDocumentHandle,
					rowIndexKeys,
				).then(async ([indexDocuments, _shouldFlushCollectionDocument]) => {
					this.deleteIndexes(rowId, indexDocuments, deletedIndexes);
					this.setIndexes(rowId, indexDocuments, newIndexes);

					flushDocumentIds.push(
						...Object.values(indexDocuments).map(
							(indexDocument) => indexDocument.documentId,
						),
					);
				});
			}
		});
		collectionDocumentHandle.change((collection: C) => {
			collection.byId[rowHandle.documentId] = Date.now();
		});

		await promise;
		await this.repo.flush(flushDocumentIds);

		return [rowId, rowHandle.doc()] as RowResult<R>;
	}

	async delete(rowId: AutomergeDocumentId<R>) {
		const rowHandle = await findDocument(this.repo, rowId);

		const collectionDocumentHandle = await this.collectionDocumentHandlePromise;
		collectionDocumentHandle.change((collection: C) => {
			delete collection.byId[rowHandle.documentId];
		});

		const flushDocumentIds = [
			collectionDocumentHandle.documentId,
		] as AutomergeDocumentId[];

		const row = rowHandle.doc();
		const indexes = this.getIndexesForRow(row);
		const rowIndexKeys = Object.keys(indexes);

		if (rowIndexKeys.length) {
			const collectionDocumentHandle =
				await this.collectionDocumentHandlePromise;
			const [indexDocuments, _shouldFlushCollectionDocument] =
				await this.getIndexesForCollection(
					collectionDocumentHandle,
					rowIndexKeys,
				);
			this.deleteIndexes(rowHandle.documentId, indexDocuments, indexes);

			flushDocumentIds.push(
				...Object.values(indexDocuments).map(
					(indexDocument) => indexDocument.documentId,
				),
			);
		}

		this.repo.delete(rowHandle.documentId);

		await this.repo.flush(flushDocumentIds);
	}

	private async filterRowIds(
		rowIds: AutomergeDocumentId<R>[],
		{
			filter,
			sort,
			offset = 0,
			limit = Number.POSITIVE_INFINITY,
		}: CollectionFilterOptions<R>,
	): Promise<Result<RowResult<R>[], MultiError>> {
		const useFilterFn = filter != null;
		const useSortFn = sort != null;

		const startOffset = offset * limit;
		const endOffset = startOffset + limit - 1;
		const useStartAndEnd =
			!Number.isNaN(startOffset) && !Number.isNaN(endOffset);

		let rows: RowResult<R>[] = [];
		const errors: Error[] = [];
		await Promise.all(
			(!useFilterFn && useStartAndEnd
				? rowIds.slice(startOffset, endOffset)
				: rowIds
			).map(async (rowId) => {
				let rowHandle: AutomergeDocumentHandle<R>;
				try {
					rowHandle = await findDocument(this.repo, rowId);
				} catch (error) {
					errors.push(error as Error);
					return;
				}

				this.migrateRow(rowHandle);

				if (useFilterFn) {
					if (!filter(rowHandle.doc())) {
						return;
					}
				}

				rows.push([rowHandle.documentId, rowHandle.doc()]);
			}),
		);

		if (useStartAndEnd) {
			rows = rows.slice(startOffset, endOffset);
		}
		if (useSortFn) {
			rows.sort(([_aId, a], [_bId, b]) => sort(a, b));
		}

		if (errors.length) {
			return err(new MultiError(errors));
		}

		return ok(rows);
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

		let shouldFlushCollectionDocument = false;
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
					shouldFlushCollectionDocument = true;
				}
			}),
		);

		return [indexDocuments, shouldFlushCollectionDocument] as [
			indexDocuments: Record<
				string,
				AutomergeDocumentHandle<CollectionIndexSchema<R>>
			>,
			shouldFlushCollectionDocument: boolean,
		];
	}

	private setIndexes(
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
		}
	}

	private deleteIndexes(
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
