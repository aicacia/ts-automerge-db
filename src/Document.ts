import type {
	ChangeFn,
	DocHandleChangePayload,
} from "@automerge/automerge-repo";
import type {
	RawDocumentSchema,
	AutomergeDocumentHandle,
	DocumentSchema,
	Migrations,
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
