-- ============================================================
-- AstreaBlue Trackify — Audit log + Master Data permissions
-- Safe to rerun.
-- ============================================================

-- 1. Audit log table
CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  actor_email VARCHAR(200) NULL,
  module VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NULL,
  entity_id VARCHAR(50) NULL,
  summary VARCHAR(255) NULL,
  metadata JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_company_time (company_id, created_at),
  INDEX idx_audit_module (module),
  INDEX idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB;

-- 2. New permissions
INSERT INTO permissions (permission_code, description) VALUES
  ('audit.read',       'View the audit log'),
  ('customer.manage',  'Create and update customers')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- 3. Grant to every Admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'Admin'
ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id;
