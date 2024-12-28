/*
Serves as a data storage abstraction with multiple methods of storing observers. ODB supports storage,
and querying of data. ODB has collections, each collection contains a list of documents. These documents
contain the JSON/Object data you wish to store.

Each document has its own UUID. This is included in the document stored in the driver's method regardless
of its underlying tracking methods, ensuring consistency across driver methods.

DB types:
- mongodb => Wrapper for MongoDB.
- indexeddB => Wrapper for IndexedDB, meant for storing data in the browser.
TODO:
- fs => Handles data storage directly on files.
- s3 => Stores data in S3 buckets.

Each driver has a set of functions:
- init() => Initializes the individual ODB instances used within the application.
- update() => Takes a document ID and updates it to the provided value.
- close() => Stops all async processes and connections.
*/

import { OObject } from 'destam';
import { parse } from './clone.js';

const watchers = [];
const isClient = typeof window !== 'undefined';
let drivers = isClient ? { indexeddb: {} } : { mongodb: {}, fs: {} };
export const collectionValidators = {};

/**
 * Registers a validation schema for a specific collection.
 *
 * @param {string} collection - The name of the collection.
 * @param {Object} schema - The validation schema.
 */
export const validator = (collection, schema) => {
	collectionValidators[collection] = schema;
};

/**
 * Validates data against the registered schema for a collection.
 *
 * @param {string} collection - The name of the collection.
 * @param {Object} data - The Json/Object data to validate.
 * @throws {Error} Throws an error if validation fails.
 */
const validateData = async (collection, data) => {
	const schema = collectionValidators[collection];
	if (!schema) return;

	for (const field in schema) {
		if (!(field in data)) {
			throw new Error(`Validation Error: Missing field '${field}' in collection '${collection}'.`);
		}
		const { validate, message } = schema[field];
		const isValid = await validate(data[field]);
		if (!isValid) {
			throw new Error(`Validation Error: ${message} - ${data[field]}`);
		}
	}
};

/**
 * Initializes the ODB by loading and setting up the appropriate drivers.
 *
 * @param {Object} props - Properties to send to drivers on startup.
 * @returns {Object} An object representing the initialization status of each driver.
 */
export const initODB = async (props) => {
	const basePath = isClient ? './drivers/client/' : './drivers/server/';
	const initStatus = {};

	for (const driverName in drivers) {
		try {
			let module;
			if (isClient) {
				// Use Vite's import.meta.glob for client
				const modules = import.meta.glob('./drivers/client/*.js', { eager: true });

				for (const path in modules) {
					if (path.includes(driverName)) {
						module = modules[path];
					}
				}
			} else {
				// Use dynamic imports for server
				module = await import(/* @vite-ignore */ `${basePath}${driverName}.js`);
			}

			if (module && module.default) {
				let driverInstance = module.default(props);

				if (driverInstance instanceof Promise) {
					driverInstance = await driverInstance;
				}

				drivers[driverName] = driverInstance;

				console.log(`${driverName} driver mounted.`);
				initStatus[driverName] = true;
			} else {
				throw new Error('No default export found.');
			}
		} catch (error) {
			console.log(error)
			console.warn(`Driver for ${driverName} wasn't mounted. If you need this driver, check its setup is correct.`);
			initStatus[driverName] = false;
		}
	}
	return initStatus;
};

/**
 * Closes all ODB drivers and cleans up connections.
 *
 * @param {Object} props - Properties to send to drivers on close.
 * @returns {Promise<void>} Resolves when all drivers and watchers are closed.
 */
export const closeODB = async (props) => {
	// Close drivers
	for (const driverName in drivers) {
		const driver = drivers[driverName];
		if (driver.close) {
			try {
				await driver.close(props);
				console.log(`${driverName} driver closed.`);
			} catch (error) {
				console.error(`Failed to close ${driverName} driver:`, error);
			}
		}
	}

	// Cleanup ODB watchers
	for (const watcher of watchers) {
		try {
			await watcher();
			console.log(`Watcher closed.`);
		} catch (error) {
			console.error(`Failed to close watcher:`, error);
		}
	}

	watchers.length = 0;
	drivers = {};
};

/**
 * Abstraction for data storage operations, handling creation, retrieval, updating, and deletion
 * of documents across different storage drivers.
 *
 * @param {string} driver - The storage method used to save state.
 * @param {string} collection - The collection name to search for the document.
 * @param {Object} query - The query to search for the correct document within the specified collection.
 * @param {Object} [value=OObject({})] - The default value of the document, if no query is specified a new document is created.
 * @param {Object} [props] - Extra driver-specific properties.
 * @returns {Promise<Object|boolean>} Returns the state object if successful, or false if validation fails.
 * @throws {Error} Throws an error if validation fails.
 */
export const ODB = async (driver, collection, query, value = OObject({}), props) => {
	driver = drivers[driver];

	try {
		await validateData(collection, value);
	} catch (error) {
		console.error(error.message);
		return false;
	}

	const { state_tree, id } = await driver.init(collection, query, value, props);

	if (state_tree) {
		const state = parse(JSON.stringify(state_tree));

		const watcher = state.observer.watch(async () => {
			try {
				await validateData(collection, state);
				await driver.update(collection, id, state, props);
			} catch (error) {
				console.error(error.message);
			}
		});

		watchers.push(watcher);

		return state;
	} else {
		return false;
	}
};
