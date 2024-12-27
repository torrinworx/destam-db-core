import test from 'node:test';
import { expect } from 'chai';

import { OObject } from "destam";
import { initODB, ODB, validator } from "../odb.js";

// ODB tests

test("", () => {
	let state;

	
})

(async () => {
	await initODB();

	validator('test', {
		email: {
			validate: (value) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
			message: "Invalid email format.",
		},
		password: {
			validate: (value) => typeof value === 'string' && value.length >= 6,
			message: "Password must be at least 6 characters long.",
		},
		username: {
			validate: (value) => typeof value === 'string' && value.trim().length > 0,
			message: "Username cannot be empty.",
		},
	});

	let test;

	try {
		// Should fail:
		test = await ODB('mongodb', 'test', {}, OObject({
			email: true,
			password: 123123,
			username: ['injection attack!']
		}));
		console.log(test); // Expected: false
	} catch (error) {
		console.error("Failed to create invalid test document:", error.message);
	}

	try {
		// Should work:
		test = await ODB('mongodb', 'test', {}, OObject({
			email: 'test@example.com',
			password: '1234password',
			username: 'test'
		}));
		console.log(test); // Expected: Valid State Object
	} catch (error) {
		console.error("Failed to create valid test document:", error.message);
	}

	// Testing further modification:
	try {
		test.email = 0.00001; // Should trigger validation
		console.log(test);
	} catch (error) {
		console.error("Failed to update email:", error.message);
	}

	try {
		test.email = 'test2@example.com'; // Should pass validation
		console.log(test);
	} catch (error) {
		console.error("Failed to update email:", error.message);
	}
})();
