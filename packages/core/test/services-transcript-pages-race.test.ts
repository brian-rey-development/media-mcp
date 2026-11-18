import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { servicesFixture } from "./support/services-fixture.js";
import { unwrapError } from "./support/unwrap.js";

type Swap = (opened: boolean) => Promise<void>;

const race = vi.hoisted(() => ({ swap: undefined as Swap | undefined }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const swappingOpen = async (...args: Parameters<typeof actual.open>) => {
    const swap = race.swap;
    race.swap = undefined;
    await swap?.(false);
    const handle = await actual.open(...args);
    await swap?.(true);
    return handle;
  };
  return { ...actual, open: swappingOpen };
});

const NAME = "youtube-abc123.en.plain.txt";
const OTHER_NAME = "youtube-other.en.plain.txt";

describe("reading a saved transcript while the filesystem changes underneath", () => {
  const { setup, temp } = servicesFixture();
  let folder: string;
  let read: (
    path: string,
  ) => ReturnType<
    ReturnType<typeof setup>["services"]["transcriptFiles"]["read"]
  >;

  beforeEach(async () => {
    const fixture = setup();
    folder = join(fixture.root, "transcripts");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, NAME), "inside");
    await writeFile(join(folder, OTHER_NAME), "other");
    read = (path) =>
      fixture.services.transcriptFiles.read({
        path,
        startLine: 1,
        maxLines: 10,
      });
  });

  afterEach(() => {
    race.swap = undefined;
  });

  it("refuses a transcripts folder that was swapped for a link after the path was resolved", async () => {
    const outside = join(temp.path, "outside");
    await mkdir(outside);
    await writeFile(join(outside, NAME), "secret");
    race.swap = async (opened) => {
      if (opened) return;
      await rename(folder, `${folder}.moved`);
      await symlink(outside, folder);
    };

    expect(unwrapError(await read(NAME))).toMatchObject({
      code: "OUTPUT_PATH_ESCAPE",
    });
  });

  it("refuses a file that was replaced by another one after it was opened", async () => {
    race.swap = async (opened) => {
      if (!opened) return;
      await rename(join(folder, NAME), join(folder, "kept.txt"));
      await rename(join(folder, OTHER_NAME), join(folder, NAME));
    };

    expect(unwrapError(await read(NAME))).toMatchObject({
      code: "OUTPUT_PATH_ESCAPE",
    });
  });
});
