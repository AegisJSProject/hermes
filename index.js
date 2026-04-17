import { registerServiceWorker, postMessage } from './registry.js';

const policy = trustedTypes.createPolicy('local#script-url', {
	createScriptURL(input) {
		if (input.startsWith(location.origin)) {
			return input;
		}
	}
});

const reg = await registerServiceWorker(
	policy.createScriptURL(new URL('/sw.config.js', document.baseURI)),
	{ type: 'module', policy, updateViaCache: 'none' }
);

reg.update();
postMessage('Hello, World!');
