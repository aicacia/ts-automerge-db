import z from 'zod';

export type FieldState = 'valid' | 'invalid' | 'unset' | 'set';

export type Field<Z extends z.ZodSchema<T>, T = unknown> = ReturnType<typeof createField<Z, T>>;

export function createField<Z extends z.ZodSchema<T>, T = unknown>(schema: Z, intialValue?: T) {
	let value = $state(intialValue);
	let result = $state<z.ZodSafeParseResult<T>>();
	let state = $state<FieldState>('unset');

	function validate() {
		return schema.safeParseAsync(value).then((r) => {
			state = r.success ? 'valid' : 'invalid';
			result = r;
			return r;
		});
	}

	$effect(() => {
		if (state === 'unset') {
			return;
		}
		validate();
	});

	return {
		get value() {
			return value;
		},
		set value(newValue: T | undefined) {
			state = 'set';
			value = newValue;
		},
		get result() {
			return result;
		},
		get errors() {
			if (state === 'unset') {
				return [];
			}
			return result?.error?.issues ?? [];
		},
		get state() {
			return state;
		},
		validate() {
			state = 'set';
			return validate();
		},
		reset() {
			state = 'unset';
			result = undefined;
			value = intialValue;
		}
	};
}

export function createForm<Z extends z.ZodObject, T extends z.infer<Z> = z.infer<Z>>(
	schema: Z,
	intialValue?: T
) {
	const form = {} as {
		[K in keyof T]: Field<z.ZodSchema<T[K]>, T[K]>;
	} & {
		validate(): Promise<z.ZodSafeParseResult<T>>;
		reset(): void;
	};
	const fieldNames = Object.keys(schema.shape) as (keyof T)[];

	for (const fieldName of fieldNames) {
		// TODO: if it is a object schema (maybe an array too) create a sub form field thingy
		// @ts-expect-error ikwid
		form[fieldName] = createField(schema.shape[fieldName], intialValue?.[fieldName]);
	}

	form.validate = async () => {
		const result = {} as z.ZodSafeParseResult<T>;

		const issues: z.core.$ZodIssue[] = [];
		const data = {} as T;
		await Promise.all(
			fieldNames.map(async (fieldName) => {
				const fieldResult = await form[fieldName].validate();
				if (fieldResult.error) {
					for (const issue of fieldResult.error.issues) {
						issue.path.unshift(fieldName);
						issues.push(issue);
					}
				}
				// @ts-expect-error ikwid
				data[fieldName] = fieldResult.data;
			})
		);
		if (issues.length) {
			// @ts-expect-error ikwid
			result.error = new z.ZodError<T>(issues);
			result.success = false;
		} else {
			result.data = data;
			result.success = true;
		}
		return result;
	};
	form.reset = () => {
		for (const fieldName of fieldNames) {
			form[fieldName].reset();
		}
	};

	return form;
}
