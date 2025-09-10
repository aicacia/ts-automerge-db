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

export type CollectionIndexKey<R extends RowSchema> =
	| keyof R
	| readonly (keyof R)[];

export function collectionIndexKeysAreEqual<R extends RowSchema>(
	a: CollectionIndexKey<R>,
	b: CollectionIndexKey<R>,
) {
	if (a === b) {
		return true;
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) {
			return false;
		}
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) {
				return false;
			}
		}
		return true;
	}
	return false;
}

export type CollectionSchemaOptionsIndexes<R extends RowSchema> = Record<
	string,
	CollectionIndexKey<R>
>;

export interface CollectionSchemaOptions<R extends RowSchema> {
	readonly type: Type<R>;
	readonly indexes: CollectionSchemaOptionsIndexes<R>;
	readonly rowMigrations: Migrations<R>;
}

export type ExtractRowParametersFromIndexKey<
	R extends RowSchema,
	O extends CollectionSchemaOptions<R>,
	K extends keyof O["indexes"],
> = O["indexes"][K] extends readonly [infer K0]
	? readonly [R[Extract<K0, keyof R>]]
	: O["indexes"][K] extends readonly [infer K0, infer K1]
		? readonly [R[Extract<K0, keyof R>], R[Extract<K1, keyof R>]]
		: O["indexes"][K] extends readonly [infer K0, infer K1, infer K2]
			? readonly [
					R[Extract<K0, keyof R>],
					R[Extract<K1, keyof R>],
					R[Extract<K2, keyof R>],
				]
			: O["indexes"][K] extends readonly [
						infer K0,
						infer K1,
						infer K2,
						infer K3,
					]
				? readonly [
						R[Extract<K0, keyof R>],
						R[Extract<K1, keyof R>],
						R[Extract<K2, keyof R>],
						R[Extract<K3, keyof R>],
					]
				: O["indexes"][K] extends readonly [
							infer K0,
							infer K1,
							infer K2,
							infer K3,
							infer K4,
						]
					? readonly [
							R[Extract<K0, keyof R>],
							R[Extract<K1, keyof R>],
							R[Extract<K2, keyof R>],
							R[Extract<K3, keyof R>],
							R[Extract<K4, keyof R>],
						]
					: R[Extract<O["indexes"][K], keyof R>];

export interface CollectionIndexDocumentSchema<R extends RowSchema> {
	[key: string]: Record<AutomergeDocumentId<R>, true>;
}

export interface CollectionIndex<R extends RowSchema> {
	key: CollectionIndexKey<R>;
	indexDocumentId: AutomergeDocumentId<CollectionIndexDocumentSchema<R>>;
}

export interface CollectionSchema<R extends RowSchema> extends DocumentSchema {
	name: string;
	byId: Record<AutomergeDocumentId<R>, number>;
	indexes: Record<string, CollectionIndex<R>>;
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
		K extends Extract<keyof O["indexes"], string>,
		V extends ExtractRowParametersFromIndexKey<R, O, K>,
	>(
		indexName: K,
		values: V,
		options: CollectionFilterOptions<R> = {},
	): Promise<Result<RowResult<R>[], MultiError>> {
		const collectionHandle = await this.collectionDocumentHandlePromise;
		const indexDocuments = await getIndexDocuments<R, C>(
			this.repo,
			collectionHandle,
			[indexName],
		);

		const indexDocument = indexDocuments[indexName];
		if (indexDocument) {
			const index = indexDocument.doc() as CollectionIndexDocumentSchema<R>;
			const indexValue = getIndexForValues(values as never);
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
		const collectionDocument = collectionDocumentHandle.doc() as Doc<C>;

		const flushDocumentIds = [
			rowHandle.documentId,
			collectionDocumentHandle.documentId,
		] as AutomergeDocumentId[];

		const rowIndexes = getIndexesForRow(row, collectionDocument.indexes);
		const rowIndexKeys = Object.keys(rowIndexes);

		if (rowIndexKeys.length > 0) {
			const indexDocuments = await getIndexDocuments<R, C>(
				this.repo,
				collectionDocumentHandle,
				rowIndexKeys,
			);

			setIndexes(rowHandle.documentId, indexDocuments, rowIndexes);

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
		const collectionDocument = collectionDocumentHandle.doc() as Doc<C>;
		const rowHandle = await findDocument(this.repo, rowId);

		const flushDocumentIds = [
			rowHandle.documentId,
			collectionDocumentHandle.documentId,
		] as AutomergeDocumentId[];

		let promise: PromiseLike<void> = Promise.resolve();
		rowHandle.change((row: R) => {
			const previousIndexes = getIndexesForRow(row, collectionDocument.indexes);
			changeFn(row);
			const currentIndexes = getIndexesForRow(row, collectionDocument.indexes);
			const { newIndexes, deletedIndexes } = indexChanges(
				previousIndexes,
				currentIndexes,
			);
			const rowIndexKeys = Array.from(
				new Set(Object.keys(newIndexes).concat(Object.keys(deletedIndexes))),
			);

			if (rowIndexKeys.length) {
				promise = getIndexDocuments<R, C>(
					this.repo,
					collectionDocumentHandle,
					rowIndexKeys,
				).then(async (indexDocuments) => {
					deleteIndexes(rowId, indexDocuments, deletedIndexes);
					setIndexes(rowId, indexDocuments, newIndexes);

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
		const collectionDocument = collectionDocumentHandle.doc() as Doc<C>;

		const flushDocumentIds = [
			collectionDocumentHandle.documentId,
		] as AutomergeDocumentId[];

		const row = rowHandle.doc();
		const indexes = getIndexesForRow(row, collectionDocument.indexes);
		const rowIndexKeys = Object.keys(indexes);

		if (rowIndexKeys.length) {
			const indexDocuments = await getIndexDocuments<R, C>(
				this.repo,
				collectionDocumentHandle,
				rowIndexKeys,
			);
			deleteIndexes(rowHandle.documentId, indexDocuments, indexes);

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
}

export async function initOrCreateCollectionHandle<
	R extends RowSchema,
	C extends CollectionSchema<R>,
	I extends CollectionSchemaOptionsIndexes<R>,
>(
	repo: Repo,
	indexes: I,
	collectionDocumentId?: AutomergeDocumentId<C>,
): Promise<
	[
		collectionDocumentHandle: AutomergeDocumentHandle<C>,
		shouldFlushCollectionDocument: boolean,
	]
> {
	let collectionDocumentHandle: AutomergeDocumentHandle<C>;
	let shouldFlushCollectionDocument = false;

	const documentIds: AutomergeDocumentId[] = [];

	if (!collectionDocumentId) {
		collectionDocumentHandle = createDocument<C>(repo, {
			_mvid: 0,
			byId: {},
			indexes: Object.entries(indexes).reduce(
				(acc, [name, key]) => {
					const indexDocumentHandle = createDocument<
						CollectionIndexDocumentSchema<R>
					>(repo, {});
					documentIds.push(indexDocumentHandle.documentId);
					acc[name] = {
						key,
						indexDocumentId: indexDocumentHandle.documentId,
					};
					return acc;
				},
				{} as Record<string, CollectionIndex<R>>,
			),
		} as C);
		shouldFlushCollectionDocument = true;
	} else {
		collectionDocumentHandle = await findDocument(repo, collectionDocumentId);
		let collectionDocument = collectionDocumentHandle.doc() as Doc<C>;

		const newIndexes: [name: string, key: CollectionIndexKey<R>][] = [];
		const updatedIndexes: [name: string, key: CollectionIndexKey<R>][] = [];
		const deletedIndexes: string[] = [];
		const reIndexIndexes: string[] = [];

		for (const name of new Set(
			Object.keys(indexes).concat(Object.keys(collectionDocument.indexes)),
		)) {
			const newIndexKey = indexes[name];
			const currentIndex = collectionDocument.indexes[name];

			if (!newIndexKey) {
				deletedIndexes.push(name);
				continue;
			}
			if (!currentIndex) {
				newIndexes.push([name, newIndexKey]);
				reIndexIndexes.push(name);
				continue;
			}
			if (collectionIndexKeysAreEqual(currentIndex.key, newIndexKey)) {
				continue;
			}
			updatedIndexes.push([name, newIndexKey]);
			reIndexIndexes.push(name);
		}

		if (updatedIndexes.length || deletedIndexes.length || newIndexes.length) {
			shouldFlushCollectionDocument = true;
		}
		const indexDocuments = {} as Record<
			string,
			AutomergeDocumentHandle<CollectionIndexDocumentSchema<R>>
		>;

		collectionDocumentHandle.change((collection: C) => {
			for (const name of deletedIndexes) {
				repo.delete(collection.indexes[name].indexDocumentId);
				delete collection.indexes[name];
			}
			for (const [name, key] of newIndexes) {
				const indexDocumentHandle = createDocument<
					CollectionIndexDocumentSchema<R>
				>(repo, {});

				collection.indexes[name] = {
					key,
					indexDocumentId: indexDocumentHandle.documentId,
				};
				indexDocuments[name] = indexDocumentHandle;

				documentIds.push(indexDocumentHandle.documentId);
			}
			for (const [name, key] of updatedIndexes) {
				const indexDocumentHandle = createDocument<
					CollectionIndexDocumentSchema<R>
				>(repo, {});

				const index = collection.indexes[name];
				repo.delete(index.indexDocumentId);
				index.key = key;
				index.indexDocumentId = indexDocumentHandle.documentId;

				indexDocuments[name] = indexDocumentHandle;

				documentIds.push(indexDocumentHandle.documentId);
			}
		});

		if (reIndexIndexes.length) {
			collectionDocument = collectionDocumentHandle.doc();

			await Promise.all(
				(Object.keys(collectionDocument.byId) as AutomergeDocumentId<R>[]).map(
					async (rowId) => {
						const rowHandle = await findDocument(repo, rowId);
						const row = rowHandle.doc() as R;
						const rowIndexes = getIndexesForRow(
							row,
							collectionDocument.indexes,
							reIndexIndexes,
						);

						setIndexes(rowId, indexDocuments, rowIndexes);
					},
				),
			);
		}
	}

	if (documentIds.length) {
		await repo.flush(documentIds);
	}

	return [collectionDocumentHandle, shouldFlushCollectionDocument];
}

function getIndexesForRow<R extends RowSchema>(
	row: R,
	indexes: Record<string, CollectionIndex<R>>,
	indexNames: string[] = Object.keys(indexes),
) {
	const rowIndexes = {} as Record<string, string>;

	outer: for (const indexName of indexNames) {
		const index = indexes[indexName];
		let rowIndexValue = null;

		if (Array.isArray(index.key)) {
			const keys = index.key as (keyof R)[];

			for (let i = 0; i < keys.length; i++) {
				const rowKey = keys[i];
				const rowKeyValue = row[rowKey];
				if (rowKeyValue === null) {
					continue outer;
				}
				if (rowIndexValue === null) {
					rowIndexValue = JSON.stringify(rowKeyValue);
				} else {
					rowIndexValue += JSON.stringify(rowKeyValue);
				}
				if (i < keys.length - 1) {
					rowIndexValue += "|";
				}
			}
		} else {
			const rowKey = index.key as keyof R;
			const rowKeyValue = row[rowKey];
			if (rowKeyValue === null) {
				continue;
			}
			rowIndexValue = JSON.stringify(rowKeyValue);
		}
		if (rowIndexValue !== null) {
			rowIndexes[indexName] = rowIndexValue;
		}
	}

	return rowIndexes;
}

function getIndexForValues<R extends RowSchema, K extends keyof R>(
	values: R[K] | readonly R[K][],
): string {
	if (Array.isArray(values) && values.length > 0) {
		let indexValue: string | null = null;

		for (let i = 0; i < values.length; i++) {
			const value = values[i];
			if (indexValue === null) {
				indexValue = JSON.stringify(value);
			} else {
				indexValue += JSON.stringify(value);
			}
			if (i < values.length - 1) {
				indexValue += "|";
			}
		}

		return indexValue as string;
	}
	return JSON.stringify(values);
}

async function getIndexDocuments<
	R extends RowSchema,
	C extends CollectionSchema<R>,
>(repo: Repo, collectionHandle: AutomergeDocumentHandle<C>, names: string[]) {
	const indexDocuments = {} as Record<
		string,
		AutomergeDocumentHandle<CollectionIndexDocumentSchema<R>>
	>;

	const collection = collectionHandle.doc() as Doc<C>;
	await Promise.all(
		names.map(async (name) => {
			indexDocuments[name] = await findDocument(
				repo,
				collection.indexes[name].indexDocumentId,
			);
		}),
	);

	return indexDocuments;
}

function setIndexes<R extends RowSchema>(
	rowId: AutomergeDocumentId<R>,
	indexDocuments: Record<
		string,
		AutomergeDocumentHandle<CollectionIndexDocumentSchema<R>>
	>,
	rowIndexes: Record<string, string>,
) {
	for (const k of Object.keys(rowIndexes)) {
		const key = k as string;
		const indexDocument = indexDocuments[key];
		const rowIndex = rowIndexes[key];

		indexDocument.change((index: CollectionIndexDocumentSchema<R>) => {
			if (!index[rowIndex]) {
				index[rowIndex] = {};
			}
			index[rowIndex][rowId] = true;
		});
	}
}

function deleteIndexes<R extends RowSchema>(
	rowId: AutomergeDocumentId<R>,
	indexDocuments: Record<
		string,
		AutomergeDocumentHandle<CollectionIndexDocumentSchema<R>>
	>,
	rowIndexes: Record<string, string>,
) {
	for (const k of Object.keys(rowIndexes)) {
		const key = k as string;
		const indexDocument = indexDocuments[key];
		const rowIndex = rowIndexes[key];

		indexDocument.change((index: CollectionIndexDocumentSchema<R>) => {
			const indexIds = index[rowIndex];
			if (indexIds) {
				delete indexIds[rowId];
			}
		});
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
