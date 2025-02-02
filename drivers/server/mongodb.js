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
        insert: async (collectionName, value) => {
            const collection = db.collection(collectionName);
            const stateDoc = createStateDoc(value);
            const result = await collection.insertOne(stateDoc);
            return { state_tree: stateDoc.state_tree, id: result.insertedId }
        },

        query: async (collectionName, query) => {
            const collection = db.collection(collectionName);
            const result = await collection.findOne(query);
            if (!result) return false
            else return { state_tree: result.state_tree, id: result._id }
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
         * Removes a document from the specified collection by its ID.
         *
         * @param {string} collection - The name of the collection from which to delete the document.
         * @param {Object} id - The unique identifier of the document to delete.
         * @returns {Promise<boolean>} Returns true if the document was successfully deleted, otherwise false.
         * @throws {Error} Logs an error message if the deletion fails.
         */
        remove: async (collection, id) => {
            try {
                const result = await db.collection(collection).deleteOne({ _id: id });
                // result.deletedCount will tell us if a document was actually deleted
                return result.deletedCount > 0;
            } catch (error) {
                console.error('Error deleting document:', error);
                return false;
            }
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