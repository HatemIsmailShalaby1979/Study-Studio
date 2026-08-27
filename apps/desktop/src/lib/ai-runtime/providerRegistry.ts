// Provider Registry for the AI Runtime.
//
// Every provider is an implementation, never an assumption. Adding a runtime
// means registering one provider — no switch statements, no UI changes.

import { supports } from "./capabilities";
import type { AICapability } from "./types";
import type { AIProvider } from "./types";

export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    if (!provider?.descriptor?.id) {
      throw new Error("Cannot register a provider without a descriptor.id");
    }
    if (this.providers.has(provider.descriptor.id)) {
      throw new Error(`Provider "${provider.descriptor.id}" is already registered`);
    }
    this.providers.set(provider.descriptor.id, provider);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  get(providerId: string): AIProvider | undefined {
    return this.providers.get(providerId);
  }

  all(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /** Providers that advertise every required capability. */
  withCapabilities(required: readonly AICapability[]): AIProvider[] {
    return this.all().filter((p) => {
      const caps = p.capabilities();
      return required.every((c) => supports(caps, c));
    });
  }

  size(): number {
    return this.providers.size;
  }
}
