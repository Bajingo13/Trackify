import "../../config/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import db from "../../config/db.js";
import { staffSendPhoto } from "./tripChat.controller.js";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});

test("dispatch photo messages require a real photo after trip access is proven", async () => {
  const real = db.execute;
  db.execute = async (sql, params) => {
    assert.match(sql, /tt\.company_id = \? AND tt\.branch_id = \?/);
    assert.deepEqual(params, [15, 2, 3]);
    return [[{ tripId: 15, companyId: 2, branchId: 3, status: "in_transit", driverId: 7 }]];
  };
  try {
    const res = response();
    await staffSendPhoto({
      params: { id: "15" }, body: {}, context: { companyId: 2, branchId: 3 },
      user: { userId: 9 }, file: null,
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /choose a photo/i);
  } finally {
    db.execute = real;
  }
});

test("the staff photo route applies permission and validated upload middleware", () => {
  const source = fs.readFileSync(new URL("./chat.routes.js", import.meta.url), "utf8");
  assert.match(source, /"\/trips\/:id\/photo"[\s\S]*requirePermission\(\.\.\.SEND\)[\s\S]*chatPhotoUpload\.single\("photo"\)[\s\S]*chat\.staffSendPhoto/);
});
