export class MultiError extends Error implements Iterable<Error> {
	readonly errors: Error[];

	constructor(errors: Error[], message?: string, options?: ErrorOptions) {
		super(
			message ?? errors.map((error) => `${error.message}`).join("\n"),
			options,
		);
		this.errors = errors;
		this.stack = [
			this.stack ?? `${this.name}: ${this.message}`,
			errors.filter((error) => error.stack).map((error) => error.stack),
		].join("\n");
	}

	[Symbol.iterator]() {
		return this.errors[Symbol.iterator]();
	}
}
