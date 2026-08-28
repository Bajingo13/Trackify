-- ============================================================
-- AstreaBlue Trackify — Administration module
-- Permissions for Companies / Branches / Users / Roles management.
-- Safe to rerun.
-- ============================================================

INSERT INTO permissions (permission_code, description) VALUES
  ('company.read',  'View companies'),
  ('company.manage','Create and update companies'),
  ('branch.read',   'View branches'),
  ('branch.manage', 'Create and update branches'),
  ('user.read',     'View users'),
  ('user.manage',   'Create, update and deactivate users'),
  ('role.read',     'View roles and permissions'),
  ('role.manage',   'Create roles and assign permissions')
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- Grant every permission to the Admin role of every company.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'Admin'
ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id;
