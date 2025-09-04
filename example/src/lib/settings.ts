import {
	createDocumentSchema,
	type DocumentSchema,
} from "@aicacia/automerge-db";
import { createType } from "../../../types/Type";

export interface Settings extends DocumentSchema {
	theme: "light" | "dark";
	locale: "en" | "es";
}

export const settings = createDocumentSchema(createType<Settings>(), {
	migrations: {
		1(settings) {
			settings.theme = "dark";
			settings.locale = "en";
		},
	},
});
