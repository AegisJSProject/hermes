import { HermesWorker } from './worker.js';
import pkg from './package.json' with { type: 'json' };
import importmap from './node_modules/@shgysk8zer0/importmap/importmap.json' with { type: 'json' };

const worker = new HermesWorker([
	{
		name: pkg.name,
		version: pkg.version,
		strategy: 'network-first',
		pattern: '/*',
		prefetch: ['/', '/index.js', '/registry.js', '/favicon.svg'],
	},
	{
		name: 'unpkg',
		version: '1.0.0',
		strategy: 'cache-first',
		pattern: new URLPattern({ baseURL: 'https://unpkg.com', pathname: '/*' }),
		prefetch: [importmap.imports['@shgysk8zer0/polyfills']],
	}
], ['message']);

worker.addEventListener('message', event => console.log(event.detail.event.data));
