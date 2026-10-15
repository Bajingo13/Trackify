/**
 * Reading a driver's licence for the office.
 *
 * The scan is stateless on purpose. It happens in the Add Driver form, where
 * there is no driver yet to attach a photo to, so it takes a picture and gives
 * back what it read; nothing is stored. The form keeps the file and uploads it
 * through the ordinary licence-photo route once the driver has been saved.
 *
 * It also answers the question an office would otherwise find out too late:
 * does another driver already hold this number? That is checked here, while the
 * person is still looking at the card.
 */
import db from "../../config/db.js";
import { scanUpload } from "../../shared/licenseScan/licenseScan.service.js";

/** POST /fleet/drivers/license-scan — multipart "photo"; optional ?driverId= (the driver being edited). */
export async function scanLicense(req, res) {
  const { companyId } = req.context;
  const result = await scanUpload(req.file, `staff:${req.user?.userId ?? req.context.userId}`);

  if (result.status === "read" && result.fields.licenseNo) {
    const editing = Number(req.query.driverId) || 0;
    const [[other]] = await db.execute(
      `SELECT driver_id, first_name, last_name FROM drivers
        WHERE company_id = ? AND license_no = ? AND driver_id <> ? LIMIT 1`,
      [companyId, result.fields.licenseNo, editing]
    );
    // The office may see who; it is their own company's driver.
    if (other) {
      result.duplicateOf = { driverId: other.driver_id, name: `${other.first_name} ${other.last_name}`.trim() };
    }
  }

  res.json({ success: true, data: result });
}
