import type { Provider } from "./provider.js";

export interface Registry {
  find(url: string): Provider | undefined;
  all: readonly Provider[];
}

export const createRegistry = (providers: readonly Provider[]): Registry => ({
  find: (url) => providers.find((provider) => provider.matches(url)),
  all: providers,
});
