export type Type<T> = { _type: T };

export function createType<T>(): Type<T> {
	return {} as Type<T>;
}
