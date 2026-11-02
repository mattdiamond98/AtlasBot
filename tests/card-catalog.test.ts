import { describe, expect, it } from "vitest";
import { imageUrlForFilename } from "../src/services/card-catalog.js";

describe("imageUrlForFilename", () => {
  it("points at the site's lowercase PNG, not the LFS-tracked screenshot", () => {
    expect(imageUrlForFilename("Acid-Rain.png")).toBe(
      "https://atlas-conquest.com/assets/card-art-png/acid-rain.png",
    );
  });
});
