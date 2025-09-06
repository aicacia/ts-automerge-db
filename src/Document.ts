import type {
	ChangeFn,
	DocHandleChangePayload,
	Repo,
} from "@automerge/automerge-repo";
import {
	type RawDocumentSchema,
	type AutomergeDocumentHandle,
	type DocumentSchema,
	type Migrations,
	createDocument,
	findDocument,
	migrate,
	type AutomergeDocumentId,
} from "./util/automerge";
import type { Doc } from "@automerge/automerge";
import { createType, type Type } from "./Type";

export interface CreateDocumentSchemaParameters<D extends DocumentSchema> {
	readonly migrations?: Migrations<D>;
}

export interface CreateDocumentSchemaOptions<D extends DocumentSchema> {
	readonly type: Type<D>;
	readonly migrations?: Migrations<D>;
}

export function createDocumentSchema<D extends DocumentSchema>() {
	const type = createType<D>();

	return <const I extends CreateDocumentSchemaParameters<D>>(options: I) => ({
		...options,
		type,
	});
}

export type DocumentSubscriber<D extends DocumentSchema> = (
	doc: Doc<D>,
) => void;

export class Document<D extends DocumentSchema> {
	protected documentHandlePromise: PromiseLike<AutomergeDocumentHandle<D>>;

	constructor(documentHandlePromise: PromiseLike<AutomergeDocumentHandle<D>>) {
		this.documentHandlePromise = documentHandlePromise;
	}

	async get() {
		const documentHandle = await this.documentHandlePromise;
		const document = documentHandle.doc() as Doc<D>;
		return document;
	}

	async change(updateFn: ChangeFn<RawDocumentSchema<D>>) {
		const documentHandle = await this.documentHandlePromise;
		documentHandle.change(updateFn);
	}

	subscribe(callback: DocumentSubscriber<D>) {
		function onChange(payload: DocHandleChangePayload<D>) {
			callback(payload.doc);
		}

		const documentHandlePromise = this.documentHandlePromise.then(
			(documentHandle) => {
				documentHandle.on("change", onChange);
				callback(documentHandle.doc());
				return documentHandle;
			},
		);

		return () => {
			documentHandlePromise.then((documentHandle) => {
				documentHandle.off("change", onChange);
			});
		};
	}
}

export async function initOrCreateDocumentHandle<D extends DocumentSchema>(
	repo: Repo,
	migrations: Migrations<D>,
	documentId?: AutomergeDocumentId<D>,
): Promise<
	[documentHandle: AutomergeDocumentHandle<D>, shouldFlushDocument: boolean]
> {
	let documentHandle: AutomergeDocumentHandle<D>;
	let shouldFlushDocument = false;

	if (!documentId) {
		documentHandle = createDocument<D>(repo, {
			_mvid: -1,
		} as D);
		shouldFlushDocument = true;
	} else {
		documentHandle = await findDocument(repo, documentId);
	}

	if (migrate(documentHandle, migrations)) {
		shouldFlushDocument = true;
	}

	return [documentHandle, shouldFlushDocument];
}
