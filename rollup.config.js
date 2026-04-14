export default [{
	input: 'hermes.js',
	external: () => true,
	output: [{
		file: 'hermes.cjs',
		format: 'cjs',
	}],
}, {
	input: 'registry.js',
	output: [{
		file: 'registry.cjs',
		format: 'cjs',
	}],
}, {
	input: 'worker.js',
	output: [{
		file: 'worker.cjs',
		format: 'cjs',
	}],
}];
