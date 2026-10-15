import { describe, expect, it, vi } from "vitest";
import { prepareLicenceFile, isPdf } from "./prepareLicenceFile";

const pdf = (name = "scan.pdf") => new File([new Uint8Array(10)], name, { type: "application/pdf" });
const photo = () => new File([new Uint8Array(10)], "card.jpg", { type: "image/jpeg" });
const same = async (f) => f;

describe("getting a licence ready to read", () => {
  it("passes a photo through the usual shrinking, and never touches the PDF converter", async () => {
    const render = vi.fn();
    const shrink = vi.fn(async (f) => f);
    const f = photo();
    expect(await prepareLicenceFile(f, { render, shrink })).toBe(f);
    expect(shrink).toHaveBeenCalledWith(f);
    expect(render).not.toHaveBeenCalled();
  });

  it("turns a PDF into a JPEG of its first page, named after the scan", async () => {
    const render = vi.fn(async () => new Blob([new Uint8Array(50)], { type: "image/jpeg" }));
    const out = await prepareLicenceFile(pdf("Reyes licence.pdf"), { render, shrink: same });
    expect(render).toHaveBeenCalledTimes(1);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("Reyes licence.jpg");
    expect(out.size).toBe(50);
  });

  it("recognises a PDF by name when the browser gives it no type", async () => {
    expect(isPdf(new File([], "scan.PDF", { type: "" }))).toBe(true);
    expect(isPdf(photo())).toBe(false);
    expect(isPdf(null)).toBe(false);
  });

  it("says what to do when a PDF cannot be opened — whether it threw or drew nothing", async () => {
    const message = /Save the licence as a JPG or PNG/;
    await expect(prepareLicenceFile(pdf(), { render: async () => { throw new Error("bad pdf"); }, shrink: same })).rejects.toThrow(message);
    await expect(prepareLicenceFile(pdf(), { render: async () => null, shrink: same })).rejects.toThrow(message);
  });

  it("the rendered page is shrunk like any other photo before it is sent", async () => {
    const shrink = vi.fn(async (f) => f);
    await prepareLicenceFile(pdf(), { render: async () => new Blob([new Uint8Array(5)]), shrink });
    expect(shrink).toHaveBeenCalledTimes(1);
    expect(shrink.mock.calls[0][0].type).toBe("image/jpeg");
  });
});
