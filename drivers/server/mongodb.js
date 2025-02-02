/*
A MongoDB driver for the ODB system, providing initialization, update, and closure
functionalities for MongoDB connections. It supports both in-memory MongoDB for testing
and persistent MongoDB instances based on environment configurations.

Each document in the collection contains a state tree and its simplified JSON version used
for querying.
*/

import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

config();

/**
 * Initializes the MongoDB driver, connecting to either an in-memory server for testing
 * or a persistent MongoDB instance based on environment variables.
 *
 * @param {Object} props - Configuration properties.
 * @param {boolean} [props.test=false] - Indicates whether to use an in-memory MongoDB server.
 * @returns {Promise<Object>} An object containing the init, update, and close methods for the driver.
 */
export default async (createStateDoc, { test = false }) => { // TODO: switch test to .env ENV var or something
    let dbClient;
    let db;
    let mongoServer;

    if (test) { // use in memory mongodb for tests
        mongoServer = await MongoMemoryServer.create();
        const dbURL = mongoServer.getUri();
        dbClient = new MongoClient(dbURL, { serverSelectionTimeoutMS: 1000 });

        try {
            await dbClient.connect();
            console.log('\x1b[32mConnected to in-memory MongoDB\x1b[0m');
        } catch (error) {
            console.error('Failed to connect to in-memory MongoDB:', error);
            process.exit(1);
        }

        db = dbClient.db('webcore');
    } else {
        const dbURL = process.env.DB;
        dbClient = new MongoClient(dbURL, { serverSelectionTimeoutMS: 1000 });

        try {
            await dbClient.connect();
            console.log('\x1b[32mConnected to MongoDB\x1b[0m');
        } catch (error) {
            console.error('Failed to connect to MongoDB:', error);
            process.exit(1);
        }

        db = dbClient.db('webcore');
    }

    return {
        /**
         * Initializes a collection by mapping it to a MongoDB collection. If a query is provided,
         * it searches for an existing document matching the query. If no document is found,
         * it returns false. If no query is provided, it creates a new document with the given value.
         *
         * @param {string} collectionName - The name of the collection.
         * @param {Object} query - The query to search for an existing document.
         * @param {Object} value - The value to insert if no query is provided.
         * @returns {Promise<Object|boolean>} An object containing the state tree and document ID, or false if not found.
         */
        init: async (collectionName, query, value) => {
            let state_tree, id;
            const collection = db.collection(collectionName);

            const createDoc = async () => {
                const stateDoc = createStateDoc(value);
                const result = await collection.insertOne(stateDoc);
                id = result.insertedId;
                state_tree = stateDoc.state_tree;
            };

            // No query, create doc
            if (Object.keys(query).length === 0) {
                await createDoc();
            } else { // yes query, fetch doc
                const result = await collection.findOne(query);

                if (!result) { // no query result found
                    if (!value) {
                        return false; // return false if no query results or value
                    }
                    await createDoc(); // if no query results but value, create doc from value.
                } else {
                    state_tree = result.state_tree;
                    id = result._id;
                }
            }

            return { state_tree, id };
        },

        fetchDoc: async (query) => {
        },

        insertDoc: async (value) => {
        },

        /**
         * Transforms the query keys to target the 'state_json' document field.
         *
         * @param {Object} query - The original query object.
         * @returns {Object} The transformed query object with keys prefixed by 'state_json.'.
         */
        transformQuery: (query) => {
            return Object.fromEntries(
                Object.entries(query).map(([key, value]) => [`state_json.${key}`, value])
            );
        },

        /**
         * Updates a document in the specified collection with the provided state.
         *
         * @param {string} collectionName - The name of the collection.
         * @param {Object} id - The unique identifier of the document to update.
         * @param {Object} state - The new state to set in the document.
         * @returns {Promise<Object>} The result of the update operation.
         */
        update: async (collectionName, id, state) => {
            const collection = db.collection(collectionName);
            const result = await collection.updateOne(
                { _id: id },
                {
                    $set: createStateDoc(state)
                }
            );
            return result;
        },

        /**
         * Closes the MongoDB client and, if applicable, stops the in-memory MongoDB server.
         *
         * @returns {Promise<void>} Resolves when the client and server are successfully closed.
         */
        close: async () => {
            await dbClient.close();
            if (mongoServer) {
                await mongoServer.stop();
                console.log('\x1b[32mDisconnected from MongoDB and stopped in-memory MongoDB\x1b[0m');
            } else {
                console.log('\x1b[32mDisconnected from MongoDB\x1b[0m');
            }
        }
    };
};