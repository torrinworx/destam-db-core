import test from 'node:test';
import { expect } from 'chai';
import { OObject } from "destam";
import { initODB, closeODB, ODB } from "../odb.js";
import { validator, collectionValidators } from '../validation.js';

let initStatus; 
test.before(async () => {
	initStatus = await initODB({ test: true });
});

test("initialize ODB drivers", async () => {
	for (const driverName in initStatus) {
		if (initStatus[driverName]) {
			console.log(`${driverName} initialized successfully.`);
		} else {
			console.log(`${driverName} failed to initialize.`);
		}
		expect(initStatus[driverName]).to.be.a('boolean');
	}

	expect(initStatus.mongodb).to.equal(true);
});

test("validator registration", () => {
	validator('testCollection', {
		field: {
			validate: (value) => typeof value === 'number',
			message: "Field must be a number.",
		}
	});
	expect(collectionValidators).to.have.property('testCollection');
});

test("failure on validation error", async () => {
	validator('testFail', {
		requiredField: {
			validate: (value) => typeof value === 'string',
			message: "Field must be a string.",
		}
	});

	const result = await ODB('mongodb', 'testFail', {}, OObject({
		requiredField: 123
	}));

	expect(result).to.equal(false);
});

test("success on valid data", async () => {
	validator('testSuccess', {
		requiredField: {
			validate: (value) => typeof value === 'string',
			message: "Field must be a string.",
		}
	});
	
	const result = await ODB('mongodb', 'testSuccess', {}, OObject({
		requiredField: 'A valid string'
	}));

	expect(result).to.be.an('object');
});

test("updates with validation", async () => {
	const result = await ODB('mongodb', 'testSuccess', {}, OObject({
		requiredField: 'Initial value'
	}));

	try {
		// Invalid update
		result.requiredField = 123;
	} catch (error) {
		expect(error.message).to.include("Field must be a string.");
	}

	try {
		// Valid update
		result.requiredField = 'Updated value';
		expect(result.requiredField).to.equal('Updated value');
	} catch (error) {
		console.error("Unexpected validation error:", error.message);
	}
});

test("successful data querying", async () => {
	const insertResult = await ODB('mongodb', 'testQuery', {}, OObject({
		queryField: 'Queryable data'
	}));

	expect(insertResult).to.be.an('object');

	const queryResult = await ODB('mongodb', 'testQuery', { queryField: 'Queryable data' });

	expect(queryResult).to.be.an('object');
	expect(Object.keys(queryResult)).to.have.length.of.at.least(1);
	expect(queryResult).to.have.property('queryField', 'Queryable data');
});

test("query for non-existent data", async () => {
	const queryResult = await ODB('mongodb', 'testQuery', { 'queryField': 'Non-existent data' });
	expect(queryResult).to.equal(false);
});

test.after(async () => {
	try {
		await closeODB();
		console.log("Drivers closed successfully.");
	} catch (error) {
		console.error("Error closing drivers:", error);
		throw error;
	}
});
