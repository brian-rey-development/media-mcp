import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    globalSetup: ["./test/support/build-server.ts"],
    setupFiles: ["./test/support/reap-servers.ts"],
  },
});
