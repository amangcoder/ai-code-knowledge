export { AdapterRegistry } from './adapter-registry.js';
export type { LanguageAdapter, FileContext } from './language-adapter.js';
export { TypeScriptAdapter } from './typescript-adapter.js';
export { PythonAdapter } from './python-adapter.js';
export { DartAdapter } from './dart-adapter.js';
export { GoAdapter } from './go-adapter.js';
export { JavaAdapter } from './java-adapter.js';
export { KotlinAdapter } from './kotlin-adapter.js';
export { RustAdapter } from './rust-adapter.js';
export { SwiftAdapter } from './swift-adapter.js';

import { AdapterRegistry } from './adapter-registry.js';
import { TypeScriptAdapter } from './typescript-adapter.js';
import { PythonAdapter } from './python-adapter.js';
import { DartAdapter } from './dart-adapter.js';
import { GoAdapter } from './go-adapter.js';
import { JavaAdapter } from './java-adapter.js';
import { KotlinAdapter } from './kotlin-adapter.js';
import { RustAdapter } from './rust-adapter.js';
import { SwiftAdapter } from './swift-adapter.js';

/**
 * Creates a registry with the default set of language adapters.
 * Supports: TypeScript/JS, Python, Dart, Go, Java, Kotlin, Rust, Swift.
 * New language adapters can be registered after creation.
 */
export function createDefaultRegistry(): AdapterRegistry {
    const registry = new AdapterRegistry();
    registry.register(new TypeScriptAdapter());
    registry.register(new PythonAdapter());
    registry.register(new DartAdapter());
    registry.register(new GoAdapter());
    registry.register(new JavaAdapter());
    registry.register(new KotlinAdapter());
    registry.register(new RustAdapter());
    registry.register(new SwiftAdapter());
    return registry;
}
