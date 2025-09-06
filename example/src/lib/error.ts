import type z from 'zod';

type RecursiveRemap<T, V> = {
	[K in keyof T]?: T[K] extends object ? RecursiveRemap<T[K], V> : V;
};

export function zodErrorToObject<T>(error?: z.ZodError<T>) {
	const errors = {} as RecursiveRemap<T, z.core.$ZodIssue[]>;
	if (!error) {
		return errors;
	}

	for (const issue of error.issues) {
		let errorsPart = errors as any;

		for (let i = 0; i < issue.path.length - 1; i++) {
			const path = issue.path[i];

			if (!errorsPart[path]) {
				errorsPart[path] = {};
			}
			errorsPart = errorsPart[path];
		}

		const path = issue.path[issue.path.length - 1];
		if (!errorsPart[path]) {
			errorsPart[path] = [];
		}
		errorsPart[path].push(issue);
	}

	return errors;
}
