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
export const validateData = async (collection, data) => {
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
