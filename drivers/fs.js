import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async (createStateDoc, { test = false, baseDir } = {}) => {
    // Default directory for storing data unless passed in via props.
    // If test mode is on, we use "test_data" folder to avoid overwriting real data.
    const rootDir = baseDir
        || join(__dirname, test ? 'test_data' : 'fs_data');

    const ensureDir = async (dir) => {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') {
                throw err;
            }
        }
    };

    const getCollectionPath = async (collectionName) => {
        const collectionPath = join(rootDir, collectionName);
        await ensureDir(collectionPath);
        return collectionPath;
    };

    const readDocFile = async (collectionPath, docId) => {
        const docPath = join(collectionPath, `${docId}.json`);
        try {
            const fileContent = await fs.readFile(docPath, 'utf-8');
            return JSON.parse(fileContent);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    };

    const writeDocFile = async (collectionPath, docId, doc) => {
        const docPath = join(collectionPath, `${docId}.json`);
        await fs.writeFile(docPath, JSON.stringify(doc, null, 2), 'utf-8');
    };

    return {
        create: async (collectionName, value) => {
            const collectionPath = await getCollectionPath(collectionName);
            const stateDoc = createStateDoc(value);
            // Assign an ID
            const newId = randomUUID();
            stateDoc.id = newId;

            await writeDocFile(collectionPath, newId, stateDoc);

            return { state_tree: stateDoc.state_tree, id: stateDoc.id };
        },

        query: async (collectionName, queryObj) => {
            const collectionPath = await getCollectionPath(collectionName);

            let fileNames;
            try {
                fileNames = await fs.readdir(collectionPath);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return false;
                }
                throw error;
            }

            const simplifiedQuery = {};
            for (const [key, val] of Object.entries(queryObj)) {
                const isStateJsonKey = key.startsWith('state_json.');
                const actualKey = isStateJsonKey ? key.replace('state_json.', '') : key;
                simplifiedQuery[actualKey] = val;
            }

            for (const fileName of fileNames) {
                if (!fileName.endsWith('.json')) continue;
                const docId = fileName.replace('.json', '');
                const doc = await readDocFile(collectionPath, docId);
                if (!doc) continue;

                const matches = Object.entries(simplifiedQuery).every(([k, v]) => {
                    if (!doc.state_json) return false;
                    return doc.state_json[k] === v;
                });

                if (matches) {
                    return { state_tree: doc.state_tree, id: doc.id };
                }
            }
            return false;
        },

        update: async (collectionName, id, state) => {
            const collectionPath = await getCollectionPath(collectionName);
            const doc = await readDocFile(collectionPath, id);
            if (!doc) {
                return false;
            }

            const newDoc = createStateDoc(state);
            newDoc.id = doc.id;

            await writeDocFile(collectionPath, id, newDoc);
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

        close: async () => {
            // Remove test_data folder if test mode is on
            if (test) {
                try {
                    await fs.rm(rootDir, { recursive: true, force: true });
                } catch (error) {
                    console.error(`Error removing test data directory at ${rootDir}:`, error);
                }
            }
        },
    };
};