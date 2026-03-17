export { AdapterRegistry } from './adapter-registry.js';
export type { LanguageAdapter, FileContext } from './language-adapter.js';
export { TypeScriptAdapter } from './typescript-adapter.js';
export { PythonAdapter } from './python-adapter.js';

import { AdapterRegistry } from './adapter-registry.js';
import { TypeScriptAdapter } from './typescript-adapter.js';
import { PythonAdapter } from './python-adapter.js';

/**
 * Creates a registry with the default set of language adapters (TypeScript/JS + Python).
 * New language adapters can be registered after creation.
 */
export function createDefaultRegistry(): AdapterRegistry {
    const registry = new AdapterRegistry();
    registry.register(new TypeScriptAdapter());
    registry.register(new PythonAdapter());
    return registry;
}
