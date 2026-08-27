// Session Manager for the AI Runtime.
//
// Tracks the user's provider + model selection for the whole app session.
// The selection is pinned: generation never auto-switches to a different
// model. `null` selection means "auto" (best available).

export class SessionManager {
  private selectedProviderId: string | null = null;
  private selectedModel: string | null = null;

  setProvider(providerId: string | null): void {
    this.selectedProviderId = providerId;
  }

  getProvider(): string | null {
    return this.selectedProviderId;
  }

  setModel(model: string | null): void {
    this.selectedModel = model;
  }

  getModel(): string | null {
    return this.selectedModel;
  }

  /** True when a model is explicitly pinned for the session. */
  hasPinnedModel(): boolean {
    return this.selectedModel !== null && this.selectedModel !== "";
  }

  reset(): void {
    this.selectedProviderId = null;
    this.selectedModel = null;
  }
}
