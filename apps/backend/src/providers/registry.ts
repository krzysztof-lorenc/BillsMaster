import type { IBillProvider } from './IBillProvider.js';
import { MockProvider } from './mock/MockProvider.js';
import { TauronProvider } from './tauron/TauronProvider.js';
import { MyOrlenProvider } from './myorlen/MyOrlenProvider.js';
import { NetiaProvider } from './netia/NetiaProvider.js';
import { AquaProvider } from './aqua/AquaProvider.js';
import { EuroLanProvider } from './eurolan/EuroLanProvider.js';
import { EKartotekaProvider } from './ekartoteka/EKartotekaProvider.js';

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers = new Map<string, IBillProvider>();

  private constructor() {
    this.register(new MockProvider());
    this.register(new TauronProvider());
    this.register(new MyOrlenProvider());
    this.register(new NetiaProvider());
    this.register(new AquaProvider());
    this.register(new EuroLanProvider());
    this.register(new EKartotekaProvider());
  }

  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  public register(provider: IBillProvider): void {
    this.providers.set(provider.id, provider);
  }

  public get(id: string): IBillProvider | undefined {
    return this.providers.get(id);
  }

  public has(id: string): boolean {
    return this.providers.has(id);
  }

  public getAll(): IBillProvider[] {
    return Array.from(this.providers.values());
  }
}

export const providerRegistry = ProviderRegistry.getInstance();
