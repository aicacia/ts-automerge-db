export type Ok<T> = [value: T, error: undefined];
export type Err<E = Error> = [value: undefined, error: E];
export type Result<T, E = Error> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
	return [value, undefined];
}

export function err<E = Error>(error: E): Err<E> {
	return [undefined, error];
}
