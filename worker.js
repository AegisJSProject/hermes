/// <reference lib="webworker" />

/**
 * @typedef {'cache-first' | 'network-first' | 'stale-while-revalidate' | 'network-only' | 'cache-only'} CachingStrategy
 */

/** @type {ServiceWorkerGlobalScope} */
const sw = globalThis;

// const handleError = () => {};
const handleError = console.error;

/**
 * @typedef {object} CacheConfig
 * @property {string} name The name component of ":name-:version"
 * @property {string|number} version The version component of ":name-:version"
 * @property {URLPattern} pattern URL pattern to control which URLs this is responsible for
 * @property {CachingStrategy} [strategy="network-first"] The caching pattern to employ.
 * @property {string|URL[]} [prefetch] URLs to preload to cache
 * @property {boolean} [ignoreSearch=false] Specifies whether to ignore the query string in the URL
 * @property {boolean} [ignoreMethod=false] Prevents matching operations from validating the `Request` http method
 * @property {boolean} [ignoreVary=false] Tells the matching operation not to perform `VARY` header matching
 * @property {string|URL} [fallback] Fallback document for offline document requests
 */

export class HermesWorker extends EventTarget {
	/**
	 * @type {CacheConfig[]}
	 */
	#configs = [];
	#caches = new Map();

	/**
	 *
	 * @param {CacheConfig[]} configs
	 */
	constructor(configs) {
		super();
		this.#configs = configs;

		sw.addEventListener('install', this);
		sw.addEventListener('activate', this);
		sw.addEventListener('fetch', this);
		sw.addEventListener('message', this);
		sw.addEventListener('notificationclick', this);
		sw.addEventListener('periodicsync', this);
		sw.addEventListener('sync', this);
		sw.addEventListener('push', this);
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
				this.dispatchEvent(event);
		}
	}

	/**
	 *
	 * @param {FetchEvent} event
	 */
	async #fetchHandler(event) {
		if (event.request.method === 'GET') {
			const {
				name,
				version,
				strategy = 'network-first',
				ignoreMethod = false,
				ignoreSearch = false,
				ignoreVary = false,
				fallback,
			} = this.#configs.find(({ pattern }) => pattern.test(event.request.url)) ?? {};

			if (typeof name !== 'undefined' && typeof version !== 'undefined' && strategy !== 'network-only') {
				const { promise, resolve, reject } = Promise.withResolvers();


				event.respondWith(promise.then(resp => resp instanceof Response ? resp : Response.error()).catch(async err => {
					handleError(err);
					const cache = await this.#openCache(name, version);

					if (event.request.mode === 'navigate' && (typeof fallback === 'string' || fallback instanceof URL)) {
						return cache.match(fallback)
							.then(resp => resp instanceof Response ? resp : Response.error())
							.catch(() => Response.error());
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
			await Promise.all(this.#configs.map(async ({ name, version, fallback, prefetch = []}) => {
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
				this.#configs
					.filter(config => typeof config.name !== 'undefined' && typeof config.version !== 'undefined')
					.map(config => `${config.name}-${config.version}`)
			);

			const existingCaches = await sw.caches.keys();

			await Promise.all(
				Array.from(
					existingCaches.filter(cache => ! expectedCaches.has(cache)),
					cache => sw.caches.delete(cache),
				)
			);

			await sw.clients.claim();
			resolve();
		} catch(err) {
			reject(err);
		}
	}

	/**
	 *
	 * @param {string} name
	 * @param {string} version
	 * @returns {Promise<Cache>}
	 */
	async #openCache(name, version) {
		const cacheName = `${name.trim().replaceAll(/[^@A-z0-9]/g, '_')}@${version}`;

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
