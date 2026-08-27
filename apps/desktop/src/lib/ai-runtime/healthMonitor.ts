// Health Monitor for the AI Runtime.
//
// Wraps provider health checks with a small TTL cache so repeated calls
// (lesson page, quiz engine, evaluation) don't hammer the runtime server on
// every interaction.

import type { AIHealth, AIProvider } from "./types";

const DEFAULT_HEALTH_TTL_MS = 10_000;

export class HealthMonitor {
  private readonly cache = new Map<string, { health: AIHealth; checkedAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_HEALTH_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Health snapshot for a provider. Uses a cached value when fresh; otherwise
   * re-checks. On check failure reports offline (never throws).
   */
  async check(provider: AIProvider): Promise<AIHealth> {
    const cached = this.cache.get(provider.descriptor.id);
    if (cached && Date.now() - cached.checkedAt < this.ttlMs) {
      return cached.health;
    }

    let health: AIHealth;
    try {
      health = await provider.health();
    } catch {
      health = {
        status: "offline",
        available: false,
        modelsCount: 0,
        recommendedModel: "",
      };
    }
    this.cache.set(provider.descriptor.id, { health, checkedAt: Date.now() });
    return health;
  }

  invalidate(providerId: string): void {
    this.cache.delete(providerId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
