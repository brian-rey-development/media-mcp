import { afterEach } from "vitest";
import { reapServers } from "./server-process.js";

afterEach(reapServers);
