import { join } from "node:path";
import { createDiskCache } from "../../src/infra/cache.js";
import { systemClock } from "../../src/infra/clock.js";
import type { Config } from "../../src/infra/config.js";
import type { Provider } from "../../src/providers/provider.js";
import { createRegistry } from "../../src/providers/registry.js";
import { createServices } from "../../src/services/index.js";
import type { ServiceDeps } from "../../src/services/types.js";
import { testConfig } from "./config.js";
import { createFakeProvider, type Origin } from "./fake-provider.js";
import { withTempDir } from "./temp-dir.js";

export const FIRST_ITEM = 1;

export const EN = {
  language: "en",
  timestamps: false,
  maxItems: 50,
  startIndex: FIRST_ITEM,
};

interface SetupOptions {
  overrides?: Partial<Provider>;
  config?: Partial<Config>;
  deps?: Partial<Pick<ServiceDeps, "cache" | "clock">>;
  others?: readonly Origin[];
}

export const servicesFixture = () => {
  const temp = withTempDir("media-mcp-svc-");
  const rootOf = (): string => join(temp.path, "out");
  const setup = ({
    overrides,
    config,
    deps = {},
    others = [],
  }: SetupOptions = {}) => {
    const clock = deps.clock ?? systemClock;
    const fake = createFakeProvider(overrides);
    const extras = others.map((origin) => createFakeProvider({}, origin));
    const services = createServices({
      registry: createRegistry([
        fake.provider,
        ...extras.map(({ provider }) => provider),
      ]),
      cache: deps.cache ?? createDiskCache(join(temp.path, "cache"), clock),
      config: { ...testConfig, outputRoot: rootOf(), ...config },
      clock,
    });
    return { ...fake, services, root: rootOf(), others: extras };
  };
  return { temp, setup };
};
