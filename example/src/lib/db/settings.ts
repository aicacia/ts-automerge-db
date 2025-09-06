import { createDocumentSchema, type DocumentSchema } from '@aicacia/automerge-db';

export interface Settings extends DocumentSchema {
	theme: 'light' | 'dark';
	locale: 'en' | 'es';
}

export const settings = createDocumentSchema<Settings>()({
	migrations: {
		1(settings) {
			settings.theme = 'dark';
			settings.locale = 'en';
		}
	}
});
