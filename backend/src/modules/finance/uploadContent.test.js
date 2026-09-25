import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFileType } from "./receipts.storage.js";

/**
 * What a file actually is, read from its bytes.
 *
 * The declared type is a claim the browser makes, and an HTML page sent as
 * image/png used to be stored as a photograph. The opposite mistake matters as
 * much: a real photograph with the wrong name must still be accepted, or a
 * driver's receipt is refused over a filename.
 */

const ascii = (s) => Buffer.from(s, "latin1");
const bytes = (...parts) => Buffer.concat(parts.map((p) => (typeof p === "string" ? ascii(p) : Buffer.from(p))));

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], "JFIF");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d], "IHDR");
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const heif = (brand) => bytes([0, 0, 0, 0x18], "ftyp", brand, [0, 0, 0, 0], "mif1heic");
const PDF = bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj");

test("the four image formats and PDF are recognised", () => {
  assert.equal(detectFileType(JPEG), "image/jpeg");
  assert.equal(detectFileType(PNG), "image/png");
  assert.equal(detectFileType(WEBP), "image/webp");
  assert.equal(detectFileType(PDF), "application/pdf");
});

test("HEIC is recognised whichever brand the phone wrote", () => {
  // iPhones usually write "heic"; many Android cameras write "mif1".
  for (const brand of ["heic", "heix", "mif1", "msf1", "hevc"]) {
    assert.equal(detectFileType(heif(brand)), "image/heic", `brand ${brand}`);
  }
});

test("a video in the same container is not mistaken for a photo", () => {
  // MP4 and MOV share the ftyp box. A driver's clip is not a receipt.
  assert.equal(detectFileType(bytes([0, 0, 0, 0x18], "ftyp", "isom", [0, 0, 2, 0])), null);
  assert.equal(detectFileType(bytes([0, 0, 0, 0x14], "ftyp", "qt  ", [0, 0, 0, 0])), null);
});

test("an HTML page wearing an image's type is refused", () => {
  assert.equal(detectFileType(ascii('<html><script>alert("x")</script></html>')), null);
  assert.equal(detectFileType(ascii("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>")), null);
});

test("executables and scripts are refused", () => {
  assert.equal(detectFileType(bytes("MZ", [0x90, 0])), null);           // Windows executable
  assert.equal(detectFileType(bytes([0x7f], "ELF")), null);              // Linux executable
  assert.equal(detectFileType(ascii("#!/bin/sh\nrm -rf /")), null);
});

test("a PDF with a few bytes in front of its header is still a PDF", () => {
  // Readers accept the header anywhere in the first kilobyte, and some
  // generators do put something before it.
  assert.equal(detectFileType(bytes([0xef, 0xbb, 0xbf], "%PDF-1.4\n")), "application/pdf");
});

test("an empty or truncated file is not anything", () => {
  assert.equal(detectFileType(Buffer.alloc(0)), null);
  assert.equal(detectFileType(bytes([0xff, 0xd8])), null);
  assert.equal(detectFileType(bytes([0x89, 0x50, 0x4e])), null);
});
