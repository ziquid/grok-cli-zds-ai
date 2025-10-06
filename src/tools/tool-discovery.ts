import { ToolResult } from '../types/index.js';

/**
 * Interface that all tool classes should implement to enable dynamic tool discovery
 */
export interface ToolDiscovery {
  getHandledToolNames(): string[];
}

/**
 * Mixin function that provides reflection-based tool discovery
 * Finds all async methods that return Promise<ToolResult> and treats them as tool handlers
 */
export function getHandledToolNames(instance: any): string[] {
  const toolNames: string[] = [];

  try {
    // Get all method names from the prototype
    const proto = Object.getPrototypeOf(instance);
    const methodNames = Object.getOwnPropertyNames(proto);

    for (const methodName of methodNames) {
      // Skip constructor and private methods
      if (methodName === 'constructor' || methodName.startsWith('_')) {
        continue;
      }

      const method = proto[methodName];

      // Check if it's a function
      if (typeof method === 'function') {
        // Get only the function signature (first line up to opening brace)
        const methodStr = method.toString();
        const signatureMatch = methodStr.match(/^[^{]*/);
        const signature = signatureMatch ? signatureMatch[0] : '';

        // Look for async methods (TypeScript compiles away return type annotations)
        if (signature.includes('async') || method.constructor.name === 'AsyncFunction') {
          toolNames.push(methodName);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to discover tool names via reflection:', error);
  }

  return toolNames.sort();
}

/**
 * Helper to add the ToolDiscovery implementation to any class
 */
export function implementToolDiscovery<T extends new (...args: any[]) => any>(Base: T) {
  return class extends Base implements ToolDiscovery {
    getHandledToolNames(): string[] {
      return getHandledToolNames(this);
    }
  };
}