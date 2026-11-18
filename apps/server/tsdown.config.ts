import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  fixedExtension: false,
  deps: {
    alwaysBundle: [/^@media-mcp\//],
    onlyBundle: false,
    onlyImport: ["@modelcontextprotocol/sdk", "zod"],
  },
  clean: true,
});
