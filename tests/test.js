import test from 'node:test';
import { expect } from 'chai';
import { OObject } from "destam";
import { initODB, ODB, validator, collectionValidators } from "../odb.js";

test("initialize ODB drivers", async () => {
	const initStatus = await initODB({ test: true });
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
