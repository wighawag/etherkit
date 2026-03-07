export type ExpectedUpdate =
	| {
			address: `0x${string}`;
			event: {topics: `0x${string}`[]};
	  }
	| {
			address: `0x${string}`;
			call: {data: `0x${string}`; result: `0x${string}`};
	  };

/**
 * Metadata that can be attached to a transaction for tracking purposes.
 * All fields are optional and extensible.
 */
export interface TestTransactionMetadata {
	id?: string;
	name?: string;
	args?: any[];
	description?: string;
	expectedUpdate?: ExpectedUpdate;
	[key: string]: unknown;
}
