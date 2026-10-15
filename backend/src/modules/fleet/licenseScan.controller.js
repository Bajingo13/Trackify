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
import { scanUpload } from "../../shared/licenseScan/licenseScan.service.js";
import { findLicenceHolder } from "./drivers.controller.js";

/** POST /fleet/drivers/license-scan — multipart "photo"; optional ?driverId= (the driver being edited). */
export async function scanLicense(req, res) {
  const { companyId } = req.context;
  const result = await scanUpload(req.file, `staff:${req.user?.userId ?? req.context.userId}`);

  if (result.status === "read" && result.fields.licenseNo) {
    const editing = Number(req.query.driverId) || 0;
    // Same rule as saving: separators ignored, inactive drivers included.
    const other = await findLicenceHolder(companyId, result.fields.licenseNo, editing);
    // The office may see who; it is their own company's driver. An inactive one
    // is said so, because the answer then is Reactivate, not a new record.
    if (other) {
      result.duplicateOf = {
        driverId: other.driver_id,
        name: `${other.first_name} ${other.last_name}`.trim(),
        employeeNo: other.employee_no || null,
        inactive: other.status === "inactive",
      };
    }
  }

  res.json({ success: true, data: result });
}
