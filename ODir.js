import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import * as Network from 'destam/Network.js';
import { Insert, Modify, Delete } from 'destam/Events.js';
import { createClass, createInstance, push, remove, assert } from 'destam/util.js';

const getDirectoryState = (dirPath) => {
	if (!fs.existsSync(dirPath)) return {};

	const files = fs.readdirSync(dirPath);
	return files.reduce((acc, file) => {
		const fullPath = path.join(dirPath, file);
		try {
			if (fs.statSync(fullPath).isFile()) {
				const { mtimeMs, size } = fs.statSync(fullPath);
				acc[file] = { mtimeMs, size };
			}
		} catch (err) {
			if (err.code !== 'ENOENT') throw err;
		}
		return acc;
	}, {});
};

const ODir = createClass((dirPath, id) => {
	assert(typeof dirPath === 'string', 'Directory path must be a string');

	const reg = Network.createReg(ODir, id);

	let currentState = getDirectoryState(dirPath);

	const listeners = [];
	const invokeListeners = (delta) => {
		for (const listener of listeners) {
			listener(delta);
		}
	};

	const updateDirectoryState = () => {
		const newState = getDirectoryState(dirPath);

		// Check for new or modified files
		Object.keys(newState).forEach(file => {
			if (!currentState[file]) {
				const delta = Insert(undefined, { file, ...newState[file] }, file, id);
				invokeListeners(delta);
			} else if (
				newState[file].mtimeMs !== currentState[file].mtimeMs ||
				newState[file].size !== currentState[file].size
			) {
				const delta = Modify(currentState[file], newState[file], file, id);
				invokeListeners(delta);
			}
		});

		// Check for deleted files
		Object.keys(currentState).forEach(file => {
			if (!newState[file]) {
				const delta = Delete(currentState[file], undefined, file, id);
				invokeListeners(delta);
			}
		});

		currentState = newState;
	};

	const addFile = (fileName, content = '') => {
		const fullPath = path.join(dirPath, fileName);
		fs.writeFileSync(fullPath, content, 'utf8');
		updateDirectoryState();
	};

	const removeLastFile = () => {
		const files = Object.keys(currentState);
		const fileName = files[files.length - 1];
		if (fileName) {
			const fullPath = path.join(dirPath, fileName);
			if (fs.existsSync(fullPath)) {
				fs.unlinkSync(fullPath);
				updateDirectoryState();
				return fileName;
			}
		}
		return undefined;
	};

	const spliceFiles = (start, deleteCount, ...newFiles) => {
		const files = Object.keys(currentState);
		const toRemove = files.slice(start, start + deleteCount);

		toRemove.forEach(fileName => {
			const fullPath = path.join(dirPath, fileName);
			if (fs.existsSync(fullPath)) {
				fs.unlinkSync(fullPath);
				updateDirectoryState();
			}
		});

		newFiles.forEach(({ fileName, content }) => {
			if (fileName) {
				const fullPath = path.join(dirPath, fileName);
				fs.writeFileSync(fullPath, content, 'utf8');
			}
		});

		updateDirectoryState();
	};

	const watcher = chokidar.watch(dirPath, {
		persistent: false,
		ignoreInitial: false,  // get 'add' signals for existing files if you like
		awaitWriteFinish: {
			stabilityThreshold: 3000, // how long a file must remain unchanged before we consider it "done"
			pollInterval: 100 // how frequently to check if the file size changes
		}
	});

	// For each event, refresh our directory state
	const scheduleUpdate = () => {
		// You could optionally debounce here if you want
		updateDirectoryState();
	};

	watcher
		.on('add', scheduleUpdate)
		.on('change', scheduleUpdate)
		.on('unlink', scheduleUpdate)
		.on('error', (err) => {
			console.error('Chokidar error:', err);
		});

	// Chokidar returns the watcher instance; you can close it if you need
	// For example, in your stopWatching method
	return createInstance(ODir, {
		observer: {
			get: () => reg
		},
		get: {
			value: () => Object.keys(currentState || {})
		},
		add: {
			value: addFile
		},
		pop: {
			value: removeLastFile
		},
		splice: {
			value: spliceFiles
		},
		watch: {
			value: (callback) => {
				push(listeners, callback);
				return () => remove(listeners, callback);
			}
		},
		stopWatching: {
			value: () => {
				watcher.close().then(() => {
					console.log('Chokidar closed');
				});
				for (let listener of listeners) {
					listener();
				}
				listeners.length = 0;
			}
		}
	});
}, {});

export default ODir;
