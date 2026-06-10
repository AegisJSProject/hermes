/// <reference lib="webworker" />

/**
 * @typedef {'cache-first' | 'network-first' | 'stale-while-revalidate' | 'network-only' | 'cache-only'} CachingStrategy
 */

/** @type {ServiceWorkerGlobalScope} */
const sw = globalThis;

const handleError = globalThis.reportError ?? console.error;

/**
 * @typedef {object} RouteConfig
 * @property {string} name The name component of ":name-:version"
 * @property {string|number} [version="v0.0.0"] The version component of ":name-:version"
 * @property {URLPattern|RegExp|{test(string: url) => boolean}} [pattern] URL pattern to control which URLs this is responsible for
 * @property {RequestDestination|RequestDestination[]|undefined} [destination] Matches against `request.destination`
 * @property {CachingStrategy} [strategy="network-first"] The caching pattern to employ.
 * @property {string[]|URL[]} [prefetch] URLs to preload to cache
 * @property {boolean} [ignoreSearch=false] Specifies whether to ignore the query string in the URL
 * @property {boolean} [ignoreMethod=false] Prevents matching operations from validating the `Request` http method
 * @property {boolean} [ignoreVary=false] Tells the matching operation not to perform `VARY` header matching
 * @property {string|URL|Response} [fallback] Fallback document for offline document requests
 */

/** @type {RouteConfig} */
const NULL_ROUTE = {
	name: 'unmatched',
	version: 'v0.0.0',
	strategy: 'network-only',
};

export class HermesWorker extends EventTarget {
	/**
	 * @type {RouteConfig[]}
	 */
	#routes = [];
	#caches = new Map();

	/**
	 *
	 * @param {RouteConfig[]} routes
	 * @param {string[]} [extraEvents=[]]
	 */
	constructor(routes, extraEvents = []) {
		super();
		this.#routes = this.#normalizeRoutes(routes);

		sw.addEventListener('install', this);
		sw.addEventListener('activate', this);
		sw.addEventListener('fetch', this);
		extraEvents.forEach(event => sw.addEventListener(event, this));
	}

	[Symbol.dispose]() {
		this.#routes = [];
		this.#caches.clear();
	}

	/**
	 *
	 * @param {ExtendableEvent} event
	 */
	async handleEvent(event) {
		switch(event.type) {
			case 'install':
				await this.#installHandler(event);
				break;

			case 'activate':
				await this.#activeHandler(event);
				break;

			case 'fetch':
				await this.#fetchHandler(event);
				break;

			default:
				this.dispatchEvent(new CustomEvent(event.type, {
					detail: {
						event,
						routes: this.#routes,
					}
				}));
		}
	}

	/**
	 *
	 * @param {FetchEvent} event
	 */
	async #fetchHandler(event) {
		if (event.request.method === 'GET' && (event.request.url.startsWith(location.origin) || event.request.mode === 'cors')) {
			const {
				name,
				version,
				strategy = 'network-first',
				ignoreMethod = false,
				ignoreSearch = false,
				ignoreVary = false,
				fallback,
			} = this.#matchRequest(event.request);

			if (typeof name !== 'undefined' && strategy !== 'network-only') {
				const { promise, resolve, reject } = Promise.withResolvers();
				const waiting = Promise.withResolvers();

				// Ensures a `Response` is always returned, even if `Response.error()`
				event.respondWith(promise.then(resp => resp instanceof Response ? resp : this.#getFallback({ name, version, fallback })).catch(async err => {
					handleError(err);
					const cache = await this.#openCache(name, version);

					return cache.match(fallback)
						.then(resp => resp instanceof Response ? resp : this.#getFallback({ name, version, fallback }))
						.catch(() => this.#getFallback({ name, version, fallback }));
				}));

				event.waitUntil(waiting.promise);

				/**
				 * @type {Cache}
				 */
				const cache = await this.#openCache(name, version);

				try {
					switch(strategy) {
						case 'cache-only':
							waiting.resolve();

							cache.match(event.request, { ignoreSearch, ignoreMethod, ignoreVary }).then(async cached => {
								resolve(cached instanceof Response ? cached : this.#getFallback({ name, version, fallback }));
							}).catch(reject);
							break;

						case 'cache-first':
							cache.match(event.request, { ignoreSearch, ignoreMethod, ignoreVary }).then(async cached => {
								if (cached instanceof Response) {
									resolve(cached);
									waiting.resolve();
								} else {
									const resp = await fetch(event.request);

									if (resp.ok) {
										cache.put(event.request, resp.clone()).finally(waiting.resolve);
										resolve(resp);
									} else {
										resolve(await this.#getFallback({ name, version, fallback }));
										waiting.reject();
									}
								}
							}).catch(err => {
								reject(err);
								waiting.reject();
							});
							break;

						case 'network-first':
							fetch(event.request).then(resp => {
								if (resp.ok) {
									cache.put(event.request, resp.clone()).finally(waiting.resolve);
									resolve(resp);
								} else {
									cache.match(event.request, { ignoreSearch, ignoreMethod, ignoreVary })
										.then(cached => resolve(cached instanceof Response ? cached : this.#getFallback({ name, version, fallback })))
										.catch(reject)
										.finally(waiting.resolve);
								}
							}).catch(() => {
								cache.match(event.request, { ignoreSearch, ignoreMethod, ignoreVary })
									.then(cached => resolve(cached instanceof Response ? cached : this.#getFallback({ name, version, fallback })))
									.catch(reject)
									.finally(waiting.resolve);
							});

							break;

						case 'network-only':
							// This should never be reached, but listing to exhaust all options
							waiting.resolve();
							fetch(event.request).then(resp => {
								if (resp.ok) {
									resolve(resp);
								} else {
									resolve(this.#getFallback({ name, version, fallback }));
								}
							}, reject);
							break;

						case 'stale-while-revalidate':
							cache.match(event.request, { ignoreSearch, ignoreMethod, ignoreVary }).then(async cached => {
								if (cached instanceof Response) {
									resolve(cached);

									fetch(event.request).then(async resp => {
										if (resp.ok) {
											cache.put(event.request, resp).finally(waiting.resolve);
										} else {
											waiting.resolve();
										}
									}).catch(() => waiting.resolve());

								} else {
									const resp = await fetch(event.request).catch(() => Response.error());

									if (resp.ok) {
										cache.put(event.request, resp.clone()).finally(waiting.resolve);
										resolve(resp);
									} else {
										resolve(resp);
										waiting.resolve();
									}
								}
							}).catch(err => {
								reject(err);
								waiting.reject();
							});
							break;

						default:
							waiting.resolve();
							fetch(event.request).then(resolve, reject);
					}

				} catch(err) {
					reject(err);
					waiting.reject();
				}
			}
		}
	}

	/**
	 *
	 * @param {ExtendableEvent} event
	 */
	async #installHandler(event) {
		const { promise, resolve, reject } = Promise.withResolvers();
		event.waitUntil(promise);

		try {
			await sw.skipWaiting();

			await Promise.all(this.#routes.map(async ({ name, version, fallback, prefetch = []}) => {
				const cache = await this.#openCache(name, version);

				if (typeof fallback === 'string' || fallback instanceof URL) {
					await cache.add(fallback);
				}

				if (Array.isArray(prefetch) && prefetch.length !== 0) {
					await cache.addAll(prefetch);
				}
			}));

			resolve();
		} catch(err) {
			reject(err);
		}
	}

	/**
	 *
	 * @param {ExtendableEvent} event
	 */
	async #activeHandler(event) {
		const { promise, resolve, reject } = Promise.withResolvers();
		event.waitUntil(promise);

		try {
			const expectedCaches = new Set(
				this.#routes
					.filter(config => typeof config.name !== 'undefined')
					.map(config => this.#getCacheName(config.name, config.version))
			);

			await caches.keys().then(names =>
				Promise.all(
					names.map(name => {
						if (! expectedCaches.has(name)) {
							return caches.delete(name);
						}
					}),
				),
			);

			await sw.clients.claim();
			resolve();
		} catch(err) {
			reject(err);
		}
	}

	/**
	 *
	 * @param {RouteConfig|RouteConfig[]} routes
	 * @returns {RouteConfig[]}
	 */
	#normalizeRoutes(routes) {
		if (! Array.isArray(routes)) {
			return this.#normalizeRoutes([routes]);
		} else {
			return routes.map(({
				name, version = 'v0.0.0', pattern, strategy = 'network-first', ignoreMethod = false,
				ignoreSearch = false, ignoreVary = false, prefetch = [], fallback, destination,
			}) => ({
				name, version, pattern: typeof pattern === 'string' ? this.#stringToPattern(pattern) : pattern,
				strategy, ignoreMethod, ignoreSearch, ignoreVary, prefetch, fallback, destination,
			}));
		}
	}

	/**
	 *
	 * @param {Request} request
	 * @returns {RouteConfig}
	 */
	#matchRequest(request) {
		return this.#routes.find(({ pattern, destination }) => (
			typeof destination === 'undefined' || (
				(typeof destination === 'string' && request.destination === destination)
				|| (Array.isArray(destination) && destination.includes(request.destination))
			)
		) && (
			typeof pattern?.test !== 'function'
			|| pattern.test(request.url))
		) ?? NULL_ROUTE;
	}

	#stringToPattern(str) {
		if (URL.canParse(str)) {
			return new URLPattern(str);
		} else {
			return new URLPattern({ baseURL: location.origin,  pathname: str });
		}
	}

	#getCacheName(name, version = 'v0.0.0') {
		return `${name.trim().replaceAll(/[^@A-Za-z0-9]/g, '_')}@${version}`;
	}

	/**
	 *
	 * @param {string} name
	 * @param {string} version
	 * @returns {Promise<Cache>}
	 */
	async #openCache(name, version) {
		const cacheName = this.#getCacheName(name, version);

		if (this.#caches.has(cacheName)) {
			return await this.#caches.get(cacheName);
		} else {
			const { promise, resolve, reject } = Promise.withResolvers();
			this.#caches.set(cacheName, promise);
			sw.caches.open(cacheName).then(resolve, reject);

			return await promise;
		}
	}

	/**
	 *
	 * @param {RouteConfig} config
	 * @returns {Promise<Response>}
	 */
	async #getFallback({ name, version, fallback }) {
		if (typeof fallback === 'string' || fallback instanceof URL) {
			try {
				const cache = await this.#openCache(name, version);
				const cached = await cache.match(fallback);
				return cached ?? Response.eerror();
			} catch {
				return Response.error();
			}
		} else if (fallback instanceof Response) {
			return fallback;
		} else {
			return Response.error();
		}
	}
}
