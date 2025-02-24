import test from 'node:test';
import { expect } from 'chai';
import { OObject } from "destam";
import { initODB, closeODB, ODB } from "./odb.js";
import { validator, collectionValidators } from './validation.js';

const drivers = ['indexeddb', 'mongodb', 'fs'];

let initStatus;
test.before(async () => {
	initStatus = await initODB({ test: true });
});

drivers.forEach((driver) => {
	test(`initialize driver for ${driver}`, async () => {
		if (initStatus[driver]) {
		} else {
			console.log(`${driver} failed to initialize.`);
		}

		expect(initStatus[driver]).to.be.a('boolean');
		if (driver === 'mongodb') {
			expect(initStatus.mongodb).to.equal(true);
		}
	});

	test(`validator registration for ${driver}`, () => {
		validator('testCollection', {
			field: {
				validate: (value) => typeof value === 'number',
				message: "Field must be a number.",
			}
		});
		expect(collectionValidators).to.have.property('testCollection');
	});

	test(`failure on validation error for ${driver}`, async () => {
		validator('testFail', {
			requiredField: {
				validate: (value) => typeof value === 'string',
				message: "Field must be a string.",
			}
		});

		const result = await ODB(driver, 'testFail', {}, OObject({
			requiredField: 123
		}));

		expect(result).to.equal(false);
	});

	test(`success on valid data for ${driver}`, async () => {
		validator('testSuccess', {
			requiredField: {
				validate: (value) => typeof value === 'string',
				message: "Field must be a string.",
			}
		});

		const result = await ODB(driver, 'testSuccess', {}, OObject({
			requiredField: 'A valid string'
		}));

		expect(result).to.be.an('object');
	});

	test(`updates with validation for ${driver}`, async () => {
		const result = await ODB(driver, 'testSuccess', {}, OObject({
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

	test(`successful data querying for ${driver}`, async () => {
		const insertResult = await ODB(driver, 'testQuery', {}, OObject({
			queryField: 'Queryable data'
		}));

		expect(insertResult).to.be.an('object');

		const queryResult = await ODB(driver, 'testQuery', { queryField: 'Queryable data' });
		expect(queryResult).to.be.an('object');
		expect(Object.keys(queryResult)).to.have.length.of.at.least(1);
		expect(queryResult).to.have.property('queryField', 'Queryable data');
	});

	test(`query for non-existent data for ${driver}`, async () => {
		const queryResult = await ODB(driver, 'testQuery', { queryField: 'Non-existent data' });
		expect(queryResult).to.equal(false);
	});

	test(`deletion of existing data for ${driver}`, async () => {
		const insertResult = await ODB(driver, 'testRemove', {}, OObject({ removeField: 'Removable data' }));
		expect(insertResult).to.be.an('object');

		const removeResult = await ODB.remove(driver, 'testRemove', { removeField: 'Removable data' });
		expect(removeResult).to.equal(true);

		const queryResult = await ODB(driver, 'testRemove', { removeField: 'Removable data' });
		expect(queryResult).to.equal(false);
	});

	test(`test watcher for ${driver}`, async () => {
		const watchValue = await ODB(driver, 'testWatch', {}, OObject({ value: 'mutable' }));
		expect(watchValue).to.be.an('object');

		let deltaList = [];
		watchValue.observer.watch(d => deltaList.push(d));

		watchValue.value = 'test';
		watchValue.value = 1;
		watchValue.value = [this];

		expect(deltaList).to.have.lengthOf(3);
	});
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
