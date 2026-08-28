-- ============================================================
-- AstreaBlue Trackify — Database Migration
-- Operations: Create Trip Enhancement
-- ============================================================

-- 1. Ensure companies table
CREATE TABLE IF NOT EXISTS companies (
  company_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(200) NOT NULL,
  company_code VARCHAR(50) NOT NULL UNIQUE,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Ensure branches table
CREATE TABLE IF NOT EXISTS branches (
  branch_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  branch_name VARCHAR(200) NOT NULL,
  branch_code VARCHAR(50) NOT NULL,
  prefix VARCHAR(10) NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_branch_code (company_id, branch_code),
  FOREIGN KEY (company_id) REFERENCES companies(company_id)
) ENGINE=InnoDB;

-- 3. Ensure users table
CREATE TABLE IF NOT EXISTS users (
  user_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(200) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 4. Ensure user_company_access
CREATE TABLE IF NOT EXISTS user_company_access (
  access_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  company_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_company_access (user_id, company_id, branch_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (branch_id) REFERENCES branches(branch_id)
) ENGINE=InnoDB;

-- 5. Ensure roles, permissions, user_roles, role_permissions
CREATE TABLE IF NOT EXISTS roles (
  role_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  role_name VARCHAR(100) NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  UNIQUE KEY uq_role (company_id, role_name),
  FOREIGN KEY (company_id) REFERENCES companies(company_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  permission_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  permission_code VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(role_id),
  FOREIGN KEY (permission_id) REFERENCES permissions(permission_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_roles (
  user_role_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  company_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  UNIQUE KEY uq_user_role (user_id, role_id, company_id, branch_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (role_id) REFERENCES roles(role_id),
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (branch_id) REFERENCES branches(branch_id)
) ENGINE=InnoDB;

-- 6. Customers table
CREATE TABLE IF NOT EXISTS customers (
  customer_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  customer_code VARCHAR(50) NOT NULL,
  customer_name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(200) NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(200) NULL,
  address TEXT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customer_code (company_id, customer_code),
  FOREIGN KEY (company_id) REFERENCES companies(company_id)
) ENGINE=InnoDB;

-- 7. Drivers table
CREATE TABLE IF NOT EXISTS drivers (
  driver_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  home_branch_id INT UNSIGNED NULL,
  employee_no VARCHAR(50) NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(50) NULL,
  license_no VARCHAR(100) NOT NULL,
  license_expiry DATE NOT NULL,
  status ENUM('active','inactive','on_trip') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (home_branch_id) REFERENCES branches(branch_id)
) ENGINE=InnoDB;

-- 8. Vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
  vehicle_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  home_branch_id INT UNSIGNED NULL,
  plate_no VARCHAR(20) NOT NULL,
  vehicle_type VARCHAR(100) NOT NULL,
  capacity DECIMAL(10,2) NULL,
  odometer DECIMAL(12,2) NULL DEFAULT 0,
  registration_expiry DATE NULL,
  status ENUM('active','inactive','maintenance') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plate_no (company_id, plate_no),
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (home_branch_id) REFERENCES branches(branch_id)
) ENGINE=InnoDB;

-- 9. Trip sequences (for ticket number generation)
CREATE TABLE IF NOT EXISTS trip_sequences (
  sequence_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  sequence_year SMALLINT NOT NULL,
  last_number INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_trip_seq (company_id, branch_id, sequence_year),
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (branch_id) REFERENCES branches(branch_id)
) ENGINE=InnoDB;

-- 10. Trip tickets (main table)
CREATE TABLE IF NOT EXISTS trip_tickets (
  trip_ticket_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,

  ticket_no VARCHAR(50) NOT NULL,
  customer_id INT UNSIGNED NULL,

  purpose VARCHAR(200) NOT NULL,
  origin VARCHAR(200) NOT NULL,
  destination VARCHAR(200) NOT NULL,

  scheduled_departure DATETIME NOT NULL,
  scheduled_arrival DATETIME NULL,

  actual_departure DATETIME NULL,
  actual_arrival DATETIME NULL,

  dispatch_mode ENUM('dispatcher','driver') NOT NULL DEFAULT 'dispatcher',
  priority ENUM('low','normal','high','critical') NOT NULL DEFAULT 'normal',

  cargo_description VARCHAR(500) NULL,
  cargo_quantity INT UNSIGNED NULL,
  cargo_weight DECIMAL(10,2) NULL,

  special_handling VARCHAR(500) NULL,
  dispatch_notes TEXT NULL,
  special_instructions TEXT NULL,
  notes TEXT NULL,

  status ENUM(
    'draft','validated','for_validation','for_approval',
    'approved','rejected','assigned','accepted','released',
    'in_transit','delivered','returned','operationally_closed','cancelled'
  ) NOT NULL DEFAULT 'draft',

  created_by INT UNSIGNED NOT NULL,
  submitted_by INT UNSIGNED NULL,
  submitted_at DATETIME NULL,

  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,

  rejected_by INT UNSIGNED NULL,
  rejected_at DATETIME NULL,
  rejection_reason TEXT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_ticket_no (company_id, ticket_no),
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (branch_id) REFERENCES branches(branch_id),
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

-- 11. Trip stops
CREATE TABLE IF NOT EXISTS trip_stops (
  stop_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trip_ticket_id INT UNSIGNED NOT NULL,
  stop_order TINYINT UNSIGNED NOT NULL,
  stop_type ENUM('pickup','delivery','waypoint') NOT NULL DEFAULT 'waypoint',
  location_name VARCHAR(200) NOT NULL,
  address VARCHAR(500) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  planned_arrival DATETIME NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 12. Trip assignments
CREATE TABLE IF NOT EXISTS trip_assignments (
  assignment_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  trip_ticket_id INT UNSIGNED NOT NULL,
  driver_id INT UNSIGNED NOT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  assigned_by INT UNSIGNED NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  status ENUM('assigned','accepted','released','completed','cancelled') NOT NULL DEFAULT 'assigned',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (branch_id) REFERENCES branches(branch_id),
  FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id),
  FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id),
  FOREIGN KEY (assigned_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

-- 13. Trip status history
CREATE TABLE IF NOT EXISTS trip_status_history (
  history_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  trip_ticket_id INT UNSIGNED NOT NULL,
  from_status VARCHAR(50) NULL,
  to_status VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  remarks TEXT NULL,
  changed_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (branch_id) REFERENCES branches(branch_id),
  FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id),
  FOREIGN KEY (changed_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

-- 14. Approval actions
CREATE TABLE IF NOT EXISTS approval_actions (
  action_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  trip_ticket_id INT UNSIGNED NOT NULL,
  action VARCHAR(50) NOT NULL,
  reason TEXT NULL,
  acted_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (branch_id) REFERENCES branches(branch_id),
  FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id),
  FOREIGN KEY (acted_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

-- 15. Trip tracking points
CREATE TABLE IF NOT EXISTS trip_tracking_points (
  tracking_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  trip_ticket_id INT UNSIGNED NOT NULL,
  driver_id INT UNSIGNED NOT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  speed_kph DECIMAL(6,2) NULL,
  heading DECIMAL(5,2) NULL,
  accuracy_meters DECIMAL(8,2) NULL,
  gps_status ENUM('online','offline') NOT NULL DEFAULT 'online',
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (branch_id) REFERENCES branches(branch_id),
  FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id),
  FOREIGN KEY (driver_id) REFERENCES drivers(driver_id),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id)
) ENGINE=InnoDB;

-- 16. Operational exceptions
CREATE TABLE IF NOT EXISTS operational_exceptions (
  exception_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  branch_id INT UNSIGNED NOT NULL,
  trip_ticket_id INT UNSIGNED NULL,
  exception_type VARCHAR(100) NOT NULL,
  severity ENUM('critical','warning','info') NOT NULL DEFAULT 'warning',
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  status ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  acknowledged_by INT UNSIGNED NULL,
  acknowledged_at DATETIME NULL,
  resolved_by INT UNSIGNED NULL,
  resolved_at DATETIME NULL,
  resolution_notes TEXT NULL,
  detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(company_id),
  FOREIGN KEY (branch_id) REFERENCES branches(branch_id),
  FOREIGN KEY (trip_ticket_id) REFERENCES trip_tickets(trip_ticket_id)
) ENGINE=InnoDB;

-- 17. Seed data: Company
INSERT INTO companies (company_id, company_name, company_code, status)
VALUES (1, 'AstreaBlue Logistics', 'ABL', 'active')
ON DUPLICATE KEY UPDATE company_name = company_name;

-- 18. Seed data: Branch
INSERT INTO branches (branch_id, company_id, branch_name, branch_code, prefix, status)
VALUES (1, 1, 'Davao Branch', 'DVO', 'DVO', 'active')
ON DUPLICATE KEY UPDATE branch_name = branch_name;

-- 19. Seed data: Permissions
INSERT INTO permissions (permission_code, description) VALUES
  ('trip.read', 'View trip tickets'),
  ('trip.create', 'Create trip tickets'),
  ('trip.submit', 'Submit trip tickets'),
  ('trip.validate', 'Validate trip tickets'),
  ('trip.approve', 'Approve trip tickets'),
  ('trip.assign', 'Assign drivers and vehicles'),
  ('tracking.read', 'View GPS tracking'),
  ('tracking.update', 'Submit GPS updates'),
  ('exception.read', 'View operational exceptions'),
  ('exception.create', 'Create operational exceptions'),
  ('exception.resolve', 'Resolve operational exceptions'),
  ('customer.read', 'View customers')
ON DUPLICATE KEY UPDATE description = description;

-- 20. Seed data: Admin role
INSERT INTO roles (company_id, role_name, status)
VALUES (1, 'Admin', 'active')
ON DUPLICATE KEY UPDATE role_name = role_name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.company_id = 1 AND r.role_name = 'Admin'
ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id;

-- 21. Seed data: Test users (password = bcrypt hash of 'admin123' and 'driver123')
INSERT INTO users (user_id, email, password_hash, first_name, last_name, status) VALUES
  (1, 'admin@astreablue.com', '$2b$10$rQEY5zG1G1G1G1G1G1G1GuQxQxQxQxQxQxQxQxQxQxQxQxQxQxQx', 'Sajibur', 'Rahman', 'active'),
  (2, 'driver@astreablue.com', '$2b$10$rQEY5zG1G1G1G1G1G1G1GuQxQxQxQxQxQxQxQxQxQxQxQxQxQxQx', 'Juan', 'Dela Cruz', 'active')
ON DUPLICATE KEY UPDATE email = email;

INSERT INTO user_company_access (user_id, company_id, branch_id, status) VALUES
  (1, 1, 1, 'active'),
  (2, 1, 1, 'active')
ON DUPLICATE KEY UPDATE status = status;

INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status)
SELECT 1, r.role_id, 1, 1, 'active'
FROM roles r WHERE r.company_id = 1 AND r.role_name = 'Admin'
ON DUPLICATE KEY UPDATE status = user_roles.status;

-- 22. Seed data: Test customers
INSERT INTO customers (company_id, customer_code, customer_name, contact_person, phone, status) VALUES
  (1, 'CUS-0001', 'ABC Corporation', 'John Smith', '+63 917 111 2222', 'active'),
  (1, 'CUS-0002', 'XYZ Trading', 'Jane Doe', '+63 918 333 4444', 'active'),
  (1, 'CUS-0003', 'SouthMin Builders', 'Pedro Santos', '+63 919 555 6666', 'active'),
  (1, 'CUS-0004', 'Davao Fresh Market', 'Maria Garcia', '+63 920 777 8888', 'active'),
  (1, 'CUS-0005', 'GenSan Seafood Export', 'Ana Reyes', '+63 921 999 0000', 'active')
ON DUPLICATE KEY UPDATE customer_name = customer_name;
