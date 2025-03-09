import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

config();

export default async ({ test = false }) => {
    let dbClient;
    let db;
    let mongoServer;

    if (!test) {
        const dbURL = process.env.DB;
        const dbName = process.env.DB_TABLE;

        // Check for DB and DB_TABLE in environment variables
        if (!dbURL) {
            console.error('Error: Environment variable DB is not set. Please provide the MongoDB connection string.');
        }

        if (!dbName) {
            console.error('Error: Environment variable DB_TABLE is not set. Please provide the database name.');
            process.exit(1);
        }

        dbClient = new MongoClient(dbURL, { serverSelectionTimeoutMS: 1000 });

        try {
            await dbClient.connect();
            console.log('\x1b[32mConnected to MongoDB\x1b[0m');
        } catch (error) {
            console.error('Cannot connect to MongoDB:\n', error.message);
            process.exit(1);
        }

        db = dbClient.db(dbName);

    } else {
        // Use in-memory mongodb for tests
        mongoServer = await MongoMemoryServer.create();
        const dbURL = mongoServer.getUri();
        dbClient = new MongoClient(dbURL, { serverSelectionTimeoutMS: 1000 });

        try {
            await dbClient.connect();
            console.log('\x1b[32mConnected to in-memory MongoDB\x1b[0m');
        } catch (error) {
            // Only display a simple error message
            console.error('Cannot connect to in-memory MongoDB error.');
            // Optionally, you could log more detail if needed:
            // console.error('Error details:', error.message);
            process.exit(1);
        }

        db = dbClient.db('webcore');
    }

    return {
        create: async ({ collection, stateDoc }) => {
            const result = await db.collection(collection).insertOne(stateDoc);
            return { state_tree: stateDoc.state_tree, id: result.insertedId }
        },

        query: async ({ collection, query }) => {
            const result = await db.collection(collection).findOne(query);
            if (!result) return false
            else return { state_tree: result.state_tree, id: result._id }
        },

        update: async ({ collection, id, stateDoc }) => {
            const result = await db.collection(collection).updateOne(
                { _id: id },
                { $set: stateDoc }
            );
            return result;
        },

        remove: async ({ collection, id }) => {
            try {
                const result = await db.collection(collection).deleteOne({ _id: id });
                // result.deletedCount will tell us if a document was actually deleted
                return result.deletedCount > 0;
            } catch (error) {
                console.error('Error deleting document:', error);
                return false;
            }
        },

        transformQuery: ({ query }) => Object.fromEntries(
            Object.entries(query).map(([key, value]) => [`state_json.${key}`, value])
        ),

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