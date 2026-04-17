/// <reference lib="webworker" />

/**
 * @typedef {'cache-first' | 'network-first' | 'stale-while-revalidate' | 'network-only' | 'cache-only'} CachingStrategy
 */

/** @type {ServiceWorkerGlobalScope} */
const sw = globalThis;

// const handleError = () => {};
const handleError = console.error;

/**
 * @typedef {object} RouteConfig
 * @property {string} name The name component of ":name-:version"
 * @property {string|number} [version="v0.0.0"] The version component of ":name-:version"
 * @property {URLPattern|RegExp} pattern URL pattern to control which URLs this is responsible for
 * @property {CachingStrategy} [strategy="network-first"] The caching pattern to employ.
 * @property {string[]|URL[]} [prefetch] URLs to preload to cache
 * @property {boolean} [ignoreSearch=false] Specifies whether to ignore the query string in the URL
 * @property {boolean} [ignoreMethod=false] Prevents matching operations from validating the `Request` http method
 * @property {boolean} [ignoreVary=false] Tells the matching operation not to perform `VARY` header matching
 * @property {string|URL} [fallback] Fallback document for offline document requests
 */

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
			} = this.#routes.find(({ pattern }) => pattern.test(event.request.url)) ?? {};

			if (typeof name !== 'undefined' && strategy !== 'network-only') {
				const { promise, resolve, reject } = Promise.withResolvers();

				// Ensures a `Response` is always returned, even if `Response.error()`
				event.respondWith(promise.then(resp => resp instanceof Response ? resp : Response.error()).catch(async err => {
					handleError(err);
					const cache = await this.#openCache(name, version);

					if (event.request.mode === 'navigate' && (typeof fallback === 'string' || fallback instanceof URL)) {
						return cache.match(fallback)
							.then(resp => resp instanceof Response ? resp : Response.error())
							.catch(() => Response.error());
					} else {
						return Response.error();
					}
				}));

				/**
				 * @type {Cache}
				 */
				const cache = await this.#openCache(name, version);

				try {
					switch(strategy) {
						case 'cache-only':
							cache.match(event.request, { ignoreSearch, ignoreMethod, ignoreVary }).then(async cached => {
								if (cached instanceof Response) {
									resolve(cached);
								} else {
									reject(new DOMException(`${event.request.url} [404]`));
								}
							}).catch(reject);
							break;

						case 'cache-first':
							cache.match(event.request, { ignoreSearch, ignoreMethod, ignoreVary }).then(async cached => {
								if (cached instanceof Response) {
									resolve(cached);
								} else {
									const resp = await fetch(event.request);

									if (resp.ok) {
										resolve(resp.clone());
										event.waitUntil(cache.put(event.request, resp));
									} else {
										reject(new DOMException(`${event.request.url} [${resp.status}]`, 'NetworkError'));
									}
								}
							}).catch(reject);
							break;

						case 'network-first':
							fetch(event.request).then(resp => {
								if (resp.ok) {
									resolve(resp.clone());
									event.waitUntil(cache.put(event.request, resp));
								} else {
									cache.match(event.request, { ignoreSearch, ignoreMethod, ignoreVary })
										.then(cached => resolve(cached instanceof Response ? cached : resp)).catch(reject);
								}
							}).catch(reject);

							break;

						case 'network-only':
							// This should never be reached, but listing to exhaust all options
							break;

						case 'stale-while-revalidate':
							cache.match(event.request, { ignoreSearch, ignoreMethod, ignoreVary }).then(async cached => {
								if (cached instanceof Response) {
									resolve(cached);

									event.waitUntil(fetch(event.request).then(async resp => {
										if (resp.ok) {
											await cache.put(event.request, resp);
										}
									}));

								} else {
									const resp = await fetch(event.request).catch(() => Response.error());

									if (resp.ok) {
										resolve(resp.clone());
										event.waitUntil(cache.put(event.request, resp));
									} else {
										resolve(resp);
									}
								}
							}).catch(reject);
							break;

						default:
							fetch(event.request).then(resolve).catch(() => resolve(Response.error()));
					}

				} catch(err) {
					reject(err);
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
				ignoreSearch = false, ignoreVary = false, prefetch = [], fallback,
			}) => ({
				name, version, pattern: typeof pattern === 'string' ? this.#stringToPattern(pattern) : pattern,
				strategy, ignoreMethod, ignoreSearch, ignoreVary, prefetch, fallback,
			}));
		}
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
}
