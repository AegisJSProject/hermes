import terser from '@rollup/plugin-terser';
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
	}, {
		file: 'registry.min.js',
		format: 'module',
		plugins: [terser()],
		sourcemap: true,
	}],
}, {
	input: 'worker.js',
	output: [{
		file: 'worker.cjs',
		format: 'cjs',
	}, {
		file: 'worker.min.js',
		format: 'module',
		plugins: [terser()],
		sourcemap: true,
	}],
}];
