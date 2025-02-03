/**
 * A file-system driver for the ODB system, storing collections and documents as JSON files.
 * 
 * This driver provides:
 *  - create(collectionName, value): Creates a new document with a generated UUID as its ID and writes it to disk.
 *  - query(collectionName, query): Scans all documents in collection for a match. Returns the first matching doc.
 *  - update(collectionName, id, state): Updates an existing doc by its ID.
 *  - remove(collectionName, id): Removes a doc file by its ID.
 *  - transformQuery(query): Modifies keys to match "state_json" fields, mimicking MongoDB's approach.
 * 
 * Note: This example reads all documents in a collection folder each time you query.
 *       For large data sets, consider adding an in-memory index or more advanced indexing.
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

// Get directory of current file so we can make a default path if needed.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async (createStateDoc, { test = false, baseDir } = {}) => {
    // Default directory for storing data unless passed in via props.
    // If test mode is on, we can use a separate "test_data" folder to avoid overwriting real data.
    const rootDir = baseDir
        || join(__dirname, test ? 'test_data' : 'fs_data');

    /**
     * Ensures the given directory exists (creates it recursively if needed).
     */
    async function ensureDir(dir) {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') {
                throw err;
            }
        }
    }

    /**
     * Generates a path for the target collection and ensures its folder exists.
     */
    async function getCollectionPath(collectionName) {
        const collectionPath = join(rootDir, collectionName);
        await ensureDir(collectionPath);
        return collectionPath;
    }

    /**
     * Reads a single document file (by doc ID) or returns null if it doesn't exist.
     */
    async function readDocFile(collectionPath, docId) {
        const docPath = join(collectionPath, `${docId}.json`);
        try {
            const fileContent = await fs.readFile(docPath, 'utf-8');
            return JSON.parse(fileContent);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null; // File not found
            }
            throw error;
        }
    }

    /**
     * Writes a single document file by doc ID, overwriting or creating it.
     */
    async function writeDocFile(collectionPath, docId, doc) {
        const docPath = join(collectionPath, `${docId}.json`);
        await fs.writeFile(docPath, JSON.stringify(doc, null, 2), 'utf-8');
    }

    return {
        create: async (collectionName, value) => {
            const collectionPath = await getCollectionPath(collectionName);
            const stateDoc = createStateDoc(value);
            // Assign an ID
            const newId = randomUUID();
            stateDoc.id = newId;
    
            // Write the doc to a file named <newId>.json
            await writeDocFile(collectionPath, newId, stateDoc);
    
            // Return only the fields ODB expects
            return { state_tree: stateDoc.state_tree, id: stateDoc.id };
        },
        query: async (collectionName, queryObj) => {
            const collectionPath = await getCollectionPath(collectionName);
    
            // We read all files in the collection folder:
            let fileNames;
            try {
                fileNames = await fs.readdir(collectionPath);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return false;
                }
                throw error;
            }
    
            // For a transformQuery, we typically see keys like "state_json.someKey"
            // so let's parse out the actual field name after "state_json."
            const simplifiedQuery = {};
            for (const [key, val] of Object.entries(queryObj)) {
                // If key starts with "state_json." remove that piece
                const isStateJsonKey = key.startsWith('state_json.');
                const actualKey = isStateJsonKey ? key.replace('state_json.', '') : key;
                simplifiedQuery[actualKey] = val;
            }
    
            // Look through all docs:
            for (const fileName of fileNames) {
                if (!fileName.endsWith('.json')) continue;
                const docId = fileName.replace('.json', '');
                const doc = await readDocFile(collectionPath, docId);
                if (!doc) continue;
    
                // Compare each query key with doc.state_json
                const matches = Object.entries(simplifiedQuery).every(([k, v]) => {
                    if (!doc.state_json) return false;
                    return doc.state_json[k] === v;
                });
    
                if (matches) {
                    return { state_tree: doc.state_tree, id: doc.id };
                }
            }
    
            // No match found
            return false;
        },
        update: async (collectionName, id, state) => {
            const collectionPath = await getCollectionPath(collectionName);
            const doc = await readDocFile(collectionPath, id);
            if (!doc) {
                // There's no doc to update. You could choose to create it, but
                // by ODB convention, we typically return or throw an error.
                return false;
            }
    
            // Merge new state data:
            const newDoc = createStateDoc(state);
            // Keep existing ID
            newDoc.id = doc.id;
    
            await writeDocFile(collectionPath, id, newDoc);
            // For consistency, just return an object or success code:
            return newDoc;
        },
        remove: async (collectionName, docId) => {
            const collectionPath = await getCollectionPath(collectionName);
            const docPath = join(collectionPath, `${docId}.json`);
    
            try {
                await fs.unlink(docPath);
                return true;
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return false;
                }
                throw error;
            }
        },
        transformQuery: (query) => {
            return Object.fromEntries(
                Object.entries(query).map(([key, value]) => [`state_json.${key}`, value])
            );
        },
    };
};