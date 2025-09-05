import type { ChangeFn, Doc } from "@automerge/automerge";
import type { Repo, DocHandle, DocumentId } from "@automerge/automerge-repo";

export type AutomergeDocumentId<D = unknown> = DocumentId & { _type: D };
export type AutomergeDocumentHandle<D> = DocHandle<D> & {
	documentId: AutomergeDocumentId<D>;
};

export async function findDocument<D>(
	repo: Repo,
	documentId: AutomergeDocumentId<D>,
) {
	return (await repo.find<D>(documentId)) as AutomergeDocumentHandle<D>;
}

export async function findDocumentCurrent<D>(
	repo: Repo,
	documentId: AutomergeDocumentId<D>,
) {
	return (await findDocument(repo, documentId)).doc() as Doc<D>;
}

export function createDocument<D>(
	repo: Repo,
	initialValue?: Partial<D>,
): AutomergeDocumentHandle<D> {
	return repo.create<Partial<D>>(initialValue) as AutomergeDocumentHandle<D>;
}

export async function deleteDocument<D>(
	repo: Repo,
	documentId: AutomergeDocumentId<D>,
) {
	return (await findDocument(repo, documentId)).delete();
}

export type Migrations<D extends DocumentSchema> = Record<number, ChangeFn<D>>;

export interface DocumentSchema {
	_mvid: number;
}

export type RawDocumentSchema<D extends DocumentSchema> = Omit<D, "_mvid">;

export function migrate<D extends DocumentSchema>(
	docHandle: AutomergeDocumentHandle<D>,
	migrations: Migrations<D>,
) {
	const migrationsSize = Object.keys(migrations).length;
	const initialVersion = docHandle.doc()._mvid ?? -1;

	if (initialVersion === -1 && migrationsSize === 0) {
		docHandle.change((state: D) => {
			state._mvid = 0;
		});
		return true;
	}
	let updated = false;

	for (
		let version = initialVersion === -1 ? 1 : initialVersion + 1;
		version <= migrationsSize;
		version++
	) {
		const migrationFn = migrations[version];
		if (migrationFn) {
			docHandle.change((state: D) => {
				migrationFn(state);
				state._mvid = version;
			});
			updated = true;
		}
	}

	return updated;
}

export async function initDocument<D extends DocumentSchema>(
	repo: Repo,
	migrations: Migrations<D>,
	documentId: AutomergeDocumentId<D>,
) {
	const documentHandle = await findDocument(repo, documentId);
	if (migrate(documentHandle, migrations)) {
		await repo.flush([documentHandle.documentId]);
	}
	return documentHandle;
}

export async function initOrCreateDocument<D extends DocumentSchema>(
	repo: Repo,
	migrations: Migrations<D>,
	documentId?: AutomergeDocumentId<D> | null,
) {
	if (documentId != null) {
		return await initDocument(repo, migrations, documentId);
	}
	const documentHandle = createDocument<D>(repo, {
		_mvid: -1,
	} as D);
	migrate(documentHandle, migrations);
	await repo.flush([documentHandle.documentId]);
	return documentHandle;
}
