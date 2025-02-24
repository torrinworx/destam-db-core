const dbName = 'webcore';
let cachedDB = null;
let knownStores = new Set();
let currentDBVersion = 1;
let isBootstrapped = false;

/**
 * Internally opens the database at the given version and ensures
 * that all knownStores exist. Also sets cachedDB and currentDBVersion.
 */
const _openDB = (collectionName, version, mode) =>
	new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, version);

		// If this is an actual upgrade, ensure all known stores exist.
		request.onupgradeneeded = (event) => {
			const db = event.target.result;
			knownStores.forEach((storeName) => {
				if (!db.objectStoreNames.contains(storeName)) {
					db.createObjectStore(storeName, { keyPath: '_id', autoIncrement: true });
				}
			});
			// Also ensure we create the requested store
			if (!db.objectStoreNames.contains(collectionName)) {
				db.createObjectStore(collectionName, { keyPath: '_id', autoIncrement: true });
				knownStores.add(collectionName);
			}
		};

		request.onsuccess = (event) => {
			const db = event.target.result;
			cachedDB = db;
			// Sync our in-memory version to the actual DB version
			currentDBVersion = db.version;

			const tx = db.transaction([collectionName], mode);
			const store = tx.objectStore(collectionName);
			resolve(store);
		};

		request.onerror = () => reject(new Error('Failed to open IndexedDB'));
	});

/**
 * Bootstraps once: opens the DB at currentDBVersion (no upgrade triggered unless necessary),
 * and populates knownStores with existing object store names. Also caches that DB instance.
 */
const bootstrapDB = async () => {
	if (isBootstrapped) return;
	const db = await new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, currentDBVersion);
		request.onsuccess = (e) => resolve(e.target.result);
		request.onerror = () => reject(new Error('Failed to bootstrap DB'));
	});

	cachedDB = db;
	currentDBVersion = db.version; // Keep our local version in sync

	for (let i = 0; i < db.objectStoreNames.length; i++) {
		knownStores.add(db.objectStoreNames[i]);
	}

	isBootstrapped = true;
};

/**
 * The main function to get a store reference for “collectionName”.
 * 1) Bootstraps if needed.  
 * 2) If the cachedDB has this store, just open it.  
 * 3) Otherwise, close DB if it’s open, increment version, trigger an upgrade, create the store.
 */
const openStore = async (collectionName, mode = 'readwrite') => {
	await bootstrapDB();

	if (cachedDB) {
		if (cachedDB.objectStoreNames.contains(collectionName)) {
			const tx = cachedDB.transaction([collectionName], mode);
			return tx.objectStore(collectionName);
		}
		cachedDB.close();
		cachedDB = null;
	}

	knownStores.add(collectionName);
	currentDBVersion += 1;
	return _openDB(collectionName, currentDBVersion, mode);
};

export default async (createStateDoc, { test = false }) => {

	if (test) await import(/* @vite-ignore */ 'fake-indexeddb/auto');


	const queryFunc = async (collectionName, query) => {
		const store = await openStore(collectionName, 'readonly');
		return new Promise((resolve, reject) => {
			const cursorReq = store.openCursor();
			cursorReq.onsuccess = (e) => {
				const cursor = e.target.result;
				if (!cursor) return resolve(false);
				const matches = Object.keys(query).every(
					(key) => cursor.value.state_json && cursor.value.state_json[key] === query[key]
				);
				if (matches) {
					resolve({ state_tree: cursor.value.state_tree, id: cursor.value._id });
				} else {
					cursor.continue();
				}
			};
			cursorReq.onerror = () => reject(new Error('Error finding document'));
		});
	}

	return {
		create: async (collectionName, value) => {
			const store = await openStore(collectionName);
			const doc = createStateDoc(value);
			return new Promise((resolve, reject) => {
				const req = store.add(doc);
				req.onsuccess = () => resolve({ state_tree: doc.state_tree, id: req.result });
				req.onerror = () => reject(new Error('Error adding document'));
			});
		},

		query: queryFunc,

		update: async (collectionName, id, state) => {
			const store = await openStore(collectionName);
			const updatedDoc = { _id: id, ...createStateDoc(state) };
			return new Promise((resolve, reject) => {
				const req = store.put(updatedDoc);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(new Error('Error updating document'));
			});
		},

		remove: async (collectionName, query) => {
			const doc = await queryFunc(collectionName, query);
			if (!doc) return false;
			const store = await openStore(collectionName);
			return new Promise((resolve, reject) => {
				const deleteReq = store.delete(doc.id);
				deleteReq.onsuccess = () => resolve(true);
				deleteReq.onerror = () => reject(new Error('Error deleting document'));
			});
		},

		transformQuery: (query) =>
			Object.fromEntries(Object.keys(query).map((k) => [k, query[k]])),

		close: () => {
			if (cachedDB) {
				cachedDB.close();
				cachedDB = null;
			}
		}
	};
};
