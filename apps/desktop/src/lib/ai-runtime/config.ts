// Configuration Manager for the AI Runtime.
//
// Immutable by design: configuration is frozen at construction time. Request
// defaults apply to every completion issued through the runtime; a provider
// may override them per-request, but nothing mutates shared config at runtime.

export interface AIRuntimeConfig {
  /** Provider id used when no explicit provider is requested. */
  defaultProviderId?: string;
  /** Request defaults merged under every explicit option. */
  defaults?: {
    temperature?: number;
    topP?: number;
    keepAlive?: string;
    numContext?: number;
    maxTokens?: number;
  };
}

export function createConfig(cfg: AIRuntimeConfig = {}): Readonly<AIRuntimeConfig> {
  return Object.freeze({
    defaultProviderId: cfg.defaultProviderId,
    defaults: cfg.defaults ? Object.freeze({ ...cfg.defaults }) : undefined,
  });
}
