/**
 *
 * @param {string|url|TrustedScriptURL} scriptURL
 * @param {object} config
 * @param {string} [config.scope="/"]
 * @param {"classic"|"module"} [config.type="module"]
 * @param {"all"|"imports"|"none"} [config.updateViaCache]
 * @param {TrustedTypePolicy}  [config.policy]
 * @returns {Promise<ServiceWorkerRegistration|null}
 */
export async function registerServiceWorker(scriptURL, {
	scope = document.documentElement.dataset.serviceWorkerScope ?? '/',
	type = 'module', // Default is module since this is an ESM library
	updateViaCache = document.documentElement.dataset.serviceWorkerUpdateViaCache,
	policy,
} = {}) {
	if (! ('serviceWorker' in (globalThis?.navigator ?? {}))) {
		return null;
	} else if ('trustedTypes' in globalThis && policy instanceof globalThis.TrustedTypePolicy && ! globalThis.trustedTypes.isScriptURL(scriptURL)) {
		return await navigator.serviceWorker.register(policy.createScriptURL(scriptURL), { scope, type, updateViaCache });
	} else {
		return await navigator.serviceWorker.register(scriptURL, { scope, type, updateViaCache });
	}
}

export async function postMessage(message, options) {
	const reg = await navigator.serviceWorker.ready;
	reg.active.postMessage(message, options);
}
