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

import { parse, stringify } from './clone.js';
import { validateData } from './validation.js';

import { OObject } from 'destam';

const watchers = [];
const isClient = typeof window !== 'undefined';

let drivers = [
	{
		name: 'mongodb',
		env: 'server',
		driver: {}
	},
	{
		name: 'fs',
		env: 'server',
		driver: {}
	},
	{
		name: 'indexeddb',
		env: 'client',
		driver: {}
	}
]

/**
 * Creates a database document from an observer state value.
 *
 * @param {Object} value - The observer state value.
 * @returns {Object} The document containing a state tree and its simplified JSON version used for querying.
 */
const createStateDoc = (value) => {
	if (value && (!value instanceof OObject) && typeof value === 'object') {
		throw new Error('Error: value appears to be of type "Object", ignore if this is intentional, but this could mean you have two different versions of destam installed and the OObject class is not getting recognized properly, if this is the case the state tree will not be properly built.')
	}

	return {
		state_tree: JSON.parse(stringify(value)),
		state_json: JSON.parse(JSON.stringify(value))
	};
};

/**
 * Initializes the ODB by loading and setting up the appropriate drivers.
 *
 * @param {Object} props - Properties to send to drivers on startup.
 * @returns {Object} An object representing the initialization status of each driver.
 */
export const initODB = async (props = { test: false }) => {
	const initStatus = {};

	for (const driver of drivers) {
		try {
			if (!isClient && driver.env === 'client' && !props.test) continue;
			if (isClient && driver.env === 'server') continue;

			let module;

			if (isClient && driver.env === 'client') {

				// Use Vite's import.meta.glob for client
				const modules = import.meta.glob('./drivers/client/*.js', { eager: true });

				for (const path in modules) {
					if (path.includes(driver.name)) {
						module = modules[path];
					}
				}
			} else if (props.test && driver.env === 'client') {
				module = await import(/* @vite-ignore */ `./drivers/client/${driver.name}.js`);
			} else if (driver.env === 'server') {
				// Use dynamic imports for server
				module = await import(/* @vite-ignore */ `./drivers/${driver.name}.js`);
			}

			if (module && module.default) {
				let driverInstance = module.default({
					...props
				});

				if (driverInstance instanceof Promise) {
					driverInstance = await driverInstance;
				}

				drivers[driver.name] = driverInstance;

				initStatus[driver.name] = true;
			} else {
				throw new Error('No default export found.');
			}
		} catch (error) {
			console.log(error)
			console.warn(`Driver for ${driver.name} wasn't mounted. If you need this driver, check its setup is correct.`);
			initStatus[driver.name] = false;
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
			} catch (error) {
				console.error(`Failed to close ${driverName} driver:`, error);
			}
		}
	}

	// Cleanup ODB watchers
	for (const watcher of watchers) {
		try {
			await watcher();
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
export const ODB = async ({ driver, collection, query = {}, value = null }) => {
	driver = drivers[driver];

	try {
		await validateData({ collection, data: value });
	} catch (error) {
		console.error(error.message);
		return false;
	}

	if (driver.transformQuery && query) query = driver.transformQuery({ query });

	let doc;

	if (Object.keys(query).length === 0) { // No query, create doc
		doc = await driver.create({
			collection,
			stateDoc: createStateDoc(value)
		});
	} else { // yes query, fetch doc
		doc = await driver.query({
			collection,
			query
		});

		if (!doc) { // no query result found
			if (!value) {
				// return false if no query results or value:
				return false;
			}
			// if no query results but value, create doc from value:
			doc = await driver.create({
				collection,
				value: createStateDoc(value)
			});
		}
	}

	if (!doc || typeof doc !== 'object') {
		throw new Error("Driver returned invalid doc: Doc is missing or not an object.");
	}
	if (!doc.state_tree) {
		throw new Error("Driver returned invalid doc: 'state_tree' property is missing.");
	}
	if (!doc.id) {
		throw new Error("Driver returned invalid doc: 'id' property is missing.");
	}
	if (!doc.state_tree.OBJECT_TYPE || !doc.state_tree.id || !doc.state_tree.vals) {
		throw new Error(
			"Driver returned invalid doc: 'state_tree' is missing one or more required fields (OBJECT_TYPE, id, vals)."
		);
	}

	const state = parse(JSON.stringify(doc.state_tree));

	if (!(state instanceof OObject)) {
		throw new Error(
			"Driver returned invalid doc: 'state_tree' is not converting to a valid OArray or OObject."
		);
	};

	watchers.push(state.observer.watch(async () => {
		try {
			await validateData({ collection, data: state });
			await driver.update({
				collection,
				id: doc.id,
				stateDoc: createStateDoc(state)
			});
		} catch (error) {
			console.error(error.message);
		}
	}));

	return state;
};

/**
 * Removes a document from the specified collection using the provided query.
 *
 * @param {string} driver - The name of the storage driver (e.g., 'mongodb').
 * @param {string} collection - The name of the collection from which to delete the document.
 * @param {Object} query - The query used to identify the document to be deleted.
 * @returns {Promise<boolean>} Returns true if the document was successfully deleted, otherwise false.
 * @throws {Error} Throws an error if the deletion process fails.
 */
ODB.remove = async ({ driver, collection, query }) => {
	driver = drivers[driver];

	if (driver.transformQuery) query = driver.transformQuery({ query });

	try {
		const result = await driver.query({ collection, query });

		if (result) return await driver.remove({ collection, id: result.id });
		else return false; // Requested document not found:
	} catch (error) {
		console.error(error.message);
		return false;
	}
};
