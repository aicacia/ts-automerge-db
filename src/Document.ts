import type {
	ChangeFn,
	DocHandleChangePayload,
} from "@automerge/automerge-repo";
import type {
	RawDocumentSchema,
	AutomergeDocumentHandle,
	DocumentSchema,
	Migrations,
	AutomergeDocumentId,
} from "./util/automerge";
import type { Doc } from "@automerge/automerge";
import { createType, type Type } from "./Type";
import { EventEmitter } from "eventemitter3";

export interface CreateDocumentSchemaParameters<D extends DocumentSchema> {
	readonly migrations?: Migrations<D>;
}

export interface CreateDocumentSchemaOptions<D extends DocumentSchema> {
	readonly type: Type<D>;
	readonly migrations?: Migrations<D>;
}

export function createDocumentSchema<D extends DocumentSchema>() {
	return <const I extends CreateDocumentSchemaParameters<D>>(options: I) => ({
		...options,
		type: createType<D>(),
	});
}

export type DocumentSubscriber<D extends DocumentSchema> = (
	doc: Doc<D>,
) => void;

export interface DocumentEvents<D extends DocumentSchema> {
	init(documentId: AutomergeDocumentId<D>): void;
}

export class Document<
	D extends DocumentSchema,
	E extends DocumentEvents<D> = DocumentEvents<D>,
> extends EventEmitter<E> {
	protected documentHandlePromise: Promise<AutomergeDocumentHandle<D>>;

	constructor(documentHandlePromise: Promise<AutomergeDocumentHandle<D>>) {
		super();
		this.documentHandlePromise = documentHandlePromise.then(
			(documentHandle) => {
				// @ts-expect-error
				this.emit("init", documentHandle.documentId as AutomergeDocumentId<D>);
				return documentHandle;
			},
		);
	}

	async id() {
		const documentHandle = await this.documentHandlePromise;
		return documentHandle.documentId as AutomergeDocumentId<D>;
	}

	handle() {
		return this.documentHandlePromise;
	}

	async current() {
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
