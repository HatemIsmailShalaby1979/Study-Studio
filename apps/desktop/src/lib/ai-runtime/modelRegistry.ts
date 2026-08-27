// Model Registry for the AI Runtime.
//
// Merges model metadata reported by every provider into one lookup. Model
// entries are keyed by providerId + modelId so providers with overlapping
// model names never collide.

import type { AIModel } from "./types";

export interface RegisteredModel {
  providerId: string;
  model: AIModel;
}

export class ModelRegistry {
  private readonly entries = new Map<string, RegisteredModel>();

  private key(providerId: string, modelId: string): string {
    return `${providerId}::${modelId}`;
  }

  /** Replace all models for one provider (idempotent re-discovery). */
  setModels(providerId: string, models: AIModel[]): void {
    for (const [key, entry] of this.entries) {
      if (entry.providerId === providerId) this.entries.delete(key);
    }
    for (const model of models) {
      if (!model?.id) continue;
      this.entries.set(this.key(providerId, model.id), { providerId, model });
    }
  }

  clear(): void {
    this.entries.clear();
  }

  /** All registered models (optionally filtered to one provider). */
  all(providerId?: string): RegisteredModel[] {
    return Array.from(this.entries.values()).filter(
      (e) => !providerId || e.providerId === providerId
    );
  }

  /** Find a model by provider + id. */
  get(providerId: string, modelId: string): RegisteredModel | undefined {
    return this.entries.get(this.key(providerId, modelId));
  }

  /** Count of registered models. */
  size(providerId?: string): number {
    return this.all(providerId).length;
  }
}
