-- ============================================================
-- AstreaBlue Trackify — Operations Module Seed Data
-- Realistic demo data for reporting and demonstration
-- ============================================================

-- ============================================================
-- 1. ADDITIONAL BRANCHES
-- ============================================================
INSERT INTO branches (branch_id, company_id, branch_name, branch_code, prefix, status) VALUES
  (2, 1, 'Cebu Branch', 'CEB', 'CEB', 'active'),
  (3, 1, 'General Santos Branch', 'GEN', 'GEN', 'active')
ON DUPLICATE KEY UPDATE branch_name = VALUES(branch_name);

-- ============================================================
-- 2. DRIVERS (10 realistic drivers)
-- ============================================================
INSERT INTO drivers (driver_id, company_id, home_branch_id, employee_no, first_name, last_name, phone, license_no, license_expiry, status) VALUES
  (1, 1, 1, 'DRV-001', 'Juan', 'Dela Cruz', '+63 917 123 4567', 'N01-12-345678', '2027-06-15', 'active'),
  (2, 1, 1, 'DRV-002', 'Pedro', 'Santos', '+63 918 234 5678', 'N01-12-345679', '2027-08-20', 'active'),
  (3, 1, 1, 'DRV-003', 'Miguel', 'Reyes', '+63 919 345 6789', 'N01-12-345680', '2026-12-10', 'active'),
  (4, 1, 2, 'DRV-004', 'Jose', 'Garcia', '+63 920 456 7890', 'N01-12-345681', '2027-03-25', 'active'),
  (5, 1, 2, 'DRV-005', 'Antonio', 'Lopez', '+63 921 567 8901', 'N01-12-345682', '2027-07-30', 'active'),
  (6, 1, 1, 'DRV-006', 'Ricardo', 'Villanueva', '+63 922 678 9012', 'N01-12-345683', '2026-11-05', 'active'),
  (7, 1, 3, 'DRV-007', 'Eduardo', 'Cruz', '+63 923 789 0123', 'N01-12-345684', '2027-09-18', 'active'),
  (8, 1, 3, 'DRV-008', 'Fernando', 'Gonzales', '+63 924 890 1234', 'N01-12-345685', '2027-05-12', 'active'),
  (9, 1, 1, 'DRV-009', 'Roberto', 'Fernandez', '+63 925 901 2345', 'N01-12-345686', '2026-10-28', 'active'),
  (10, 1, 2, 'DRV-010', 'Ramon', 'Mendoza', '+63 926 012 3456', 'N01-12-345687', '2027-04-08', 'active')
ON DUPLICATE KEY UPDATE first_name = VALUES(first_name);

-- ============================================================
-- 3. VEHICLES (10 realistic vehicles)
-- ============================================================
INSERT INTO vehicles (vehicle_id, company_id, home_branch_id, plate_no, vehicle_type, capacity, odometer, registration_expiry, status) VALUES
  (1, 1, 1, 'ABC 1234', 'Closed Van', 5000.00, 45230.50, '2027-06-30', 'active'),
  (2, 1, 1, 'ABC 1235', 'Furniture Truck', 8000.00, 32150.25, '2027-08-15', 'active'),
  (3, 1, 1, 'ABC 1236', 'Refrigerated Van', 3000.00, 28900.75, '2026-12-20', 'active'),
  (4, 1, 2, 'CEB 2001', 'Closed Van', 5000.00, 51200.00, '2027-03-10', 'active'),
  (5, 1, 2, 'CEB 2002', 'Flatbed Truck', 10000.00, 67800.50, '2027-07-22', 'active'),
  (6, 1, 1, 'ABC 1237', 'Box Truck', 4000.00, 38500.00, '2027-09-05', 'active'),
  (7, 1, 3, 'GEN 3001', 'Closed Van', 5000.00, 42300.25, '2027-05-18', 'active'),
  (8, 1, 3, 'GEN 3002', 'Refrigerated Van', 3000.00, 29100.00, '2026-11-30', 'active'),
  (9, 1, 1, 'ABC 1238', 'Furniture Truck', 8000.00, 55400.75, '2027-04-12', 'active'),
  (10, 1, 2, 'CEB 2003', 'Box Truck', 4000.00, 31200.00, '2027-10-25', 'active')
ON DUPLICATE KEY UPDATE plate_no = VALUES(plate_no);

-- ============================================================
-- 4. TRIP SEQUENCES (for ticket number generation)
-- ============================================================
INSERT INTO trip_sequences (company_id, branch_id, sequence_year, last_number) VALUES
  (1, 1, 2026, 25),
  (1, 2, 2026, 10),
  (1, 3, 2026, 8)
ON DUPLICATE KEY UPDATE last_number = GREATEST(last_number, VALUES(last_number));

-- ============================================================
-- 5. TRIP TICKETS (25 trips in various statuses)
-- ============================================================
INSERT INTO trip_tickets (
  trip_ticket_id, company_id, branch_id, ticket_no, customer_id,
  purpose, origin, destination,
  scheduled_departure, scheduled_arrival,
  actual_departure, actual_arrival,
  dispatch_mode, priority,
  cargo_description, cargo_quantity, cargo_weight,
  special_handling, dispatch_notes, special_instructions,
  status,
  created_by, submitted_by, submitted_at,
  approved_by, approved_at,
  rejected_by, rejected_at, rejection_reason,
  created_at, updated_at
) VALUES
  -- DRAFT trips (3)
  (1, 1, 1, 'DVO-2026-0001', 1,
    'Goods Delivery', 'Davao City', 'Tagum City',
    '2026-09-01 08:00:00', '2026-09-01 11:00:00',
    NULL, NULL,
    'dispatcher', 'normal',
    'Electronic Components', 15, 750.50,
    'Fragile - Handle with care', 'Deliver to warehouse dock 3', 'Call consignee before arrival',
    'draft',
    1, NULL, NULL,
    NULL, NULL,
    NULL, NULL, NULL,
    '2026-08-25 09:00:00', '2026-08-25 09:00:00'),

  (2, 1, 1, 'DVO-2026-0002', 3,
    'Material Transport', 'Davao City', 'Bukidnon',
    '2026-09-02 06:00:00', '2026-09-02 14:00:00',
    NULL, NULL,
    'dispatcher', 'high',
    'Construction Materials', 20, 2500.00,
    'Heavy load - Secure properly', 'Early morning departure preferred', 'Use route via Panabo',
    'draft',
    1, NULL, NULL,
    NULL, NULL,
    NULL, NULL, NULL,
    '2026-08-26 10:30:00', '2026-08-26 10:30:00'),

  (3, 1, 1, 'DVO-2026-0003', 5,
    'Seafood Transport', 'Davao City', 'GenSan',
    '2026-09-03 04:00:00', '2026-09-03 09:00:00',
    NULL, NULL,
    'driver', 'critical',
    'Fresh Seafood - Tuna', 8, 480.00,
    'Refrigerated - Keep at -18°C', 'Urgent delivery to processing plant', 'Maintain cold chain throughout',
    'draft',
    1, NULL, NULL,
    NULL, NULL,
    NULL, NULL, NULL,
    '2026-08-27 07:15:00', '2026-08-27 07:15:00'),

  -- FOR_VALIDATION trips (2)
  (4, 1, 1, 'DVO-2026-0004', 2,
    'Product Delivery', 'Davao City', 'Cebu City',
    '2026-08-30 05:00:00', '2026-08-30 18:00:00',
    NULL, NULL,
    'dispatcher', 'normal',
    'Consumer Goods', 50, 3200.00,
    NULL, 'Long haul trip - Davao to Cebu', 'Take Matnog ferry route',
    'for_validation',
    1, 1, '2026-08-28 08:00:00',
    NULL, NULL,
    NULL, NULL, NULL,
    '2026-08-24 14:00:00', '2026-08-28 08:00:00'),

  (5, 1, 1, 'DVO-2026-0005', 4,
    'Agricultural Products', 'Davao City', 'Manila',
    '2026-09-05 03:00:00', '2026-09-06 06:00:00',
    NULL, NULL,
    'dispatcher', 'high',
    'Cacao Beans', 100, 5000.00,
    'Keep dry - Moisture sensitive', 'Priority shipment for export deadline', 'Use sealed containers',
    'for_validation',
    1, 1, '2026-08-28 09:30:00',
    NULL, NULL,
    NULL, NULL, NULL,
    '2026-08-23 11:00:00', '2026-08-28 09:30:00'),

  -- FOR_APPROVAL trips (3)
  (6, 1, 1, 'DVO-2026-0006', 1,
    'Equipment Delivery', 'Davao City', 'Tagum City',
    '2026-08-29 07:00:00', '2026-08-29 10:00:00',
    NULL, NULL,
    'dispatcher', 'normal',
    'IT Equipment', 5, 120.00,
    'Fragile - Electronics', 'Deliver to main office 2nd floor', 'Use service elevator',
    'for_approval',
    1, 1, '2026-08-27 14:00:00',
    NULL, NULL,
    NULL, NULL, NULL,
    '2026-08-22 10:00:00', '2026-08-27 14:00:00'),

  (7, 1, 1, 'DVO-2026-0007', 3,
    'Construction Supplies', 'Davao City', 'Cotabato',
    '2026-08-31 06:00:00', '2026-08-31 15:00:00',
    NULL, NULL,
    'driver', 'normal',
    'Cement and Steel Bars', 40, 8000.00,
    'Heavy load', 'Deliver to construction site', 'Check delivery permit at checkpoint',
    'for_approval',
    1, 1, '2026-08-27 16:00:00',
    NULL, NULL,
    NULL, NULL, NULL,
    '2026-08-21 09:00:00', '2026-08-27 16:00:00'),

  (8, 1, 1, 'DVO-2026-0008', 5,
    'Frozen Goods Delivery', 'Davao City', 'Cebu City',
    '2026-09-01 02:00:00', '2026-09-01 15:00:00',
    NULL, NULL,
    'dispatcher', 'critical',
    'Frozen Fish Products', 25, 1500.00,
    'Refrigerated - Maintain -20°C', 'Urgent delivery to supermarket chain', 'Check temperature logger on arrival',
    'for_approval',
    1, 1, '2026-08-28 10:00:00',
    NULL, NULL,
    NULL, NULL, NULL,
    '2026-08-20 08:00:00', '2026-08-28 10:00:00'),

  -- APPROVED trips (3)
  (9, 1, 1, 'DVO-2026-0009', 2,
    'Merchandise Delivery', 'Davao City', 'Tagum City',
    '2026-08-29 09:00:00', '2026-08-29 12:00:00',
    NULL, NULL,
    'dispatcher', 'normal',
    'Retail Merchandise', 30, 1800.00,
    NULL, 'Standard delivery to branch store', 'Receiving area at back entrance',
    'approved',
    1, 1, '2026-08-26 11:00:00',
    2, '2026-08-27 09:00:00',
    NULL, NULL, NULL,
    '2026-08-19 13:00:00', '2026-08-27 09:00:00'),

  (10, 1, 1, 'DVO-2026-0010', 4,
    'Farm Products Collection', 'Bukidnon', 'Davao City',
    '2026-08-30 05:00:00', '2026-08-30 12:00:00',
    NULL, NULL,
    'driver', 'normal',
    'Banana Hearts', 60, 3600.00,
    'Handle carefully - Perishable', 'Collect from 3 farm locations', 'First stop: Valencia, second: Malaybalay',
    'approved',
    1, 1, '2026-08-25 14:00:00',
    2, '2026-08-26 10:00:00',
    NULL, NULL, NULL,
    '2026-08-18 10:00:00', '2026-08-26 10:00:00'),

  (11, 1, 1, 'DVO-2026-0011', 1,
    'Office Supplies Delivery', 'Davao City', 'Panabo City',
    '2026-08-29 10:00:00', '2026-08-29 13:00:00',
    NULL, NULL,
    'dispatcher', 'low',
    'Office Supplies', 10, 250.00,
    NULL, 'Deliver to HR department', 'Leave at reception if no one available',
    'approved',
    1, 1, '2026-08-27 08:00:00',
    2, '2026-08-27 11:00:00',
    NULL, NULL, NULL,
    '2026-08-24 15:00:00', '2026-08-27 11:00:00'),

  -- ASSIGNED trips (3)
  (12, 1, 1, 'DVO-2026-0012', 3,
    'Building Materials Delivery', 'Davao City', 'Digos City',
    '2026-08-28 06:00:00', '2026-08-28 10:00:00',
    NULL, NULL,
    'dispatcher', 'normal',
    'Tiles and Fixtures', 25, 3500.00,
    'Fragile tiles - Stack carefully', 'Deliver to new mall construction site', 'Use forklift for offloading',
    'assigned',
    1, 1, '2026-08-25 09:00:00',
    2, '2026-08-26 08:00:00',
    NULL, NULL, NULL,
    '2026-08-17 11:00:00', '2026-08-26 08:00:00'),

  (13, 1, 1, 'DVO-2026-0013', 2,
    'Spare Parts Delivery', 'Davao City', 'Tagum City',
    '2026-08-28 08:00:00', '2026-08-28 11:00:00',
    NULL, NULL,
    'driver', 'high',
    'Industrial Spare Parts', 8, 320.00,
    'Precision instruments', 'Deliver to factory floor', 'Handle with care - calibrated equipment',
    'assigned',
    1, 1, '2026-08-25 10:00:00',
    2, '2026-08-26 09:00:00',
    NULL, NULL, NULL,
    '2026-08-16 14:00:00', '2026-08-26 09:00:00'),

  (14, 1, 1, 'DVO-2026-0014', 5,
    'Export Shipment', 'Davao City', 'Cebu Port',
    '2026-08-29 04:00:00', '2026-08-29 18:00:00',
    NULL, NULL,
    'dispatcher', 'critical',
    'Dried Mangoes', 80, 4800.00,
    'Keep dry - Food product', 'Deliver to port for international shipping', 'Container no. MSKU1234567',
    'assigned',
    1, 1, '2026-08-24 16:00:00',
    2, '2026-08-25 11:00:00',
    NULL, NULL, NULL,
    '2026-08-15 09:00:00', '2026-08-25 11:00:00'),

  -- RELEASED trips (2)
  (15, 1, 1, 'DVO-2026-0015', 1,
    'Client Delivery', 'Davao City', 'Valencia City',
    '2026-08-28 05:30:00', '2026-08-28 12:00:00',
    '2026-08-28 05:35:00', NULL,
    'dispatcher', 'normal',
    'Marketing Materials', 20, 900.00,
    NULL, 'Deliver to regional office', 'Contact Mr. Santos on arrival',
    'released',
    1, 1, '2026-08-23 09:00:00',
    2, '2026-08-24 10:00:00',
    NULL, NULL, NULL,
    '2026-08-14 10:00:00', '2026-08-24 10:00:00'),

  (16, 1, 1, 'DVO-2026-0016', 4,
    'Produce Transport', 'Davao City', 'Butuan City',
    '2026-08-28 04:00:00', '2026-08-28 14:00:00',
    '2026-08-28 04:10:00', NULL,
    'driver', 'high',
    'Fresh Vegetables', 45, 2700.00,
    'Perishable - Keep cool', 'Direct delivery to market', 'Use reefer truck',
    'released',
    1, 1, '2026-08-22 08:00:00',
    2, '2026-08-23 09:00:00',
    NULL, NULL, NULL,
    '2026-08-13 11:00:00', '2026-08-23 09:00:00'),

  -- IN_TRANSIT trips (3)
  (17, 1, 1, 'DVO-2026-0017', 2,
    'Urgent Delivery', 'Davao City', 'Cagayan de Oro',
    '2026-08-28 03:00:00', '2026-08-28 12:00:00',
    '2026-08-28 03:05:00', NULL,
    'dispatcher', 'critical',
    'Pharmaceutical Supplies', 12, 450.00,
    'Temperature controlled 2-8°C', 'Urgent hospital delivery', 'Do not stack - Keep upright',
    'in_transit',
    1, 1, '2026-08-21 10:00:00',
    2, '2026-08-22 08:00:00',
    NULL, NULL, NULL,
    '2026-08-12 14:00:00', '2026-08-22 08:00:00'),

  (18, 1, 1, 'DVO-2026-0018', 3,
    'Regular Delivery', 'Davao City', 'General Santos',
    '2026-08-28 06:00:00', '2026-08-28 11:00:00',
    '2026-08-28 06:02:00', NULL,
    'dispatcher', 'normal',
    'Industrial Chemicals', 15, 1200.00,
    'HAZMAT - Handle with care', 'Deliver to plant warehouse', 'Safety data sheet included',
    'in_transit',
    1, 1, '2026-08-20 09:00:00',
    2, '2026-08-21 10:00:00',
    NULL, NULL, NULL,
    '2026-08-11 15:00:00', '2026-08-21 10:00:00'),

  (19, 1, 1, 'DVO-2026-0019', 1,
    'Event Supplies', 'Davao City', 'Zamboanga City',
    '2026-08-27 22:00:00', '2026-08-28 10:00:00',
    '2026-08-27 22:15:00', NULL,
    'dispatcher', 'normal',
    'Event Materials', 35, 2100.00,
    'Handle with care - Decorations', 'Deliver to convention center', 'Loading dock at rear entrance',
    'in_transit',
    1, 1, '2026-08-19 11:00:00',
    2, '2026-08-20 09:00:00',
    NULL, NULL, NULL,
    '2026-08-10 16:00:00', '2026-08-20 09:00:00'),

  -- DELIVERED trips (3)
  (20, 1, 1, 'DVO-2026-0020', 4,
    'Regular Shipment', 'Davao City', 'Tagum City',
    '2026-08-27 07:00:00', '2026-08-27 10:00:00',
    '2026-08-27 07:05:00', '2026-08-27 09:45:00',
    'dispatcher', 'normal',
    'Packaged Foods', 40, 2400.00,
    NULL, 'Deliver to distribution center', 'Complete delivery by 10AM',
    'delivered',
    1, 1, '2026-08-24 08:00:00',
    2, '2026-08-25 08:00:00',
    NULL, NULL, NULL,
    '2026-08-09 10:00:00', '2026-08-27 09:45:00'),

  (21, 1, 1, 'DVO-2026-0021', 2,
    'Priority Delivery', 'Davao City', 'Mati City',
    '2026-08-26 06:00:00', '2026-08-26 11:00:00',
    '2026-08-26 06:10:00', '2026-08-26 10:30:00',
    'driver', 'high',
    'Medical Supplies', 10, 180.00,
    'Handle with care - Medical', 'Deliver to hospital pharmacy', 'Require signature from receiving officer',
    'delivered',
    1, 1, '2026-08-23 09:00:00',
    2, '2026-08-24 09:00:00',
    NULL, NULL, NULL,
    '2026-08-08 11:00:00', '2026-08-26 10:30:00'),

  (22, 1, 1, 'DVO-2026-0022', 5,
    'Wholesale Delivery', 'Davao City', 'Digos City',
    '2026-08-25 08:00:00', '2026-08-25 12:00:00',
    '2026-08-25 08:15:00', '2026-08-25 11:45:00',
    'dispatcher', 'normal',
    'Beverages', 55, 3850.00,
    'Fragile - Glass bottles', 'Deliver to warehouse', 'Stack no more than 3 high',
    'delivered',
    1, 1, '2026-08-22 07:00:00',
    2, '2026-08-23 07:00:00',
    NULL, NULL, NULL,
    '2026-08-07 12:00:00', '2026-08-25 11:45:00'),

  -- OPERATIONALLY_CLOSED trips (2)
  (23, 1, 1, 'DVO-2026-0023', 1,
    'Completed Delivery', 'Davao City', 'Cotabato City',
    '2026-08-20 05:00:00', '2026-08-20 15:00:00',
    '2026-08-20 05:10:00', '2026-08-20 14:30:00',
    'dispatcher', 'normal',
    'General Merchandise', 60, 4200.00,
    NULL, 'Long haul delivery', 'POD signed by recipient',
    'operationally_closed',
    1, 1, '2026-08-18 09:00:00',
    2, '2026-08-19 09:00:00',
    NULL, NULL, NULL,
    '2026-08-05 10:00:00', '2026-08-20 16:00:00'),

  (24, 1, 1, 'DVO-2026-0024', 3,
    'Seasonal Transport', 'Davao City', 'Surigao City',
    '2026-08-19 04:00:00', '2026-08-19 16:00:00',
    '2026-08-19 04:15:00', '2026-08-19 15:45:00',
    'driver', 'normal',
    'Durian Products', 70, 4900.00,
    'Refrigerated - Strong odor contained', 'Deliver to processing facility', 'Ensure proper ventilation',
    'operationally_closed',
    1, 1, '2026-08-17 08:00:00',
    2, '2026-08-18 08:00:00',
    NULL, NULL, NULL,
    '2026-08-04 11:00:00', '2026-08-19 16:30:00'),

  -- REJECTED trip (1)
  (25, 1, 1, 'DVO-2026-0025', 4,
    'Equipment Transport', 'Davao City', 'Tagum City',
    '2026-08-28 09:00:00', '2026-08-28 12:00:00',
    NULL, NULL,
    'dispatcher', 'normal',
    'Office Furniture', 12, 960.00,
    'Handle carefully', 'Deliver to new office', NULL,
    'rejected',
    1, 1, '2026-08-26 14:00:00',
    NULL, NULL,
    2, '2026-08-27 10:00:00', 'Insufficient documentation - Missing purchase order number. Please resubmit with complete documents.',
    '2026-08-21 13:00:00', '2026-08-27 10:00:00')

ON DUPLICATE KEY UPDATE ticket_no = VALUES(ticket_no);

-- ============================================================
-- 6. TRIP STOPS (for multi-stop trips)
-- ============================================================
INSERT INTO trip_stops (trip_ticket_id, stop_order, stop_type, location_name, address, latitude, longitude, planned_arrival, notes) VALUES
  (5, 1, 'pickup', 'Cacao Farm - Valencia', 'Valencia, Bukidnon', 7.9124, 125.0924, '2026-09-05 05:00:00', 'Pick up from warehouse'),
  (5, 2, 'pickup', 'Cacao Farm - Malaybalay', 'Malaybalay, Bukidnon', 8.1524, 125.0924, '2026-09-05 07:00:00', 'Second pickup point'),
  (5, 3, 'delivery', 'Export Warehouse', 'Port Area, Manila', 14.5995, 120.9842, '2026-09-06 04:00:00', 'Final destination'),

  (10, 1, 'pickup', 'Banana Farm - Valencia', 'Valencia, Bukidnon', 7.9124, 125.0924, '2026-08-30 06:00:00', 'First collection'),
  (10, 2, 'pickup', 'Banana Farm - Malaybalay', 'Malaybalay, Bukidnon', 8.1524, 125.0924, '2026-08-30 08:00:00', 'Second collection'),
  (10, 3, 'pickup', 'Banana Farm - Impasugong', 'Impasugong, Bukidnon', 8.0524, 125.0924, '2026-08-30 09:30:00', 'Third collection'),
  (10, 4, 'delivery', 'Davao Fresh Market', 'Davao City', 7.1907, 125.4553, '2026-08-30 12:00:00', 'Final delivery'),

  (19, 1, 'pickup', 'Convention Center Warehouse', 'Davao City', 7.0731, 125.4553, '2026-08-27 22:00:00', 'Load all materials'),
  (19, 2, 'waypoint', 'Fuel Stop - Bukidnon', 'Manolo Fortich, Bukidnon', 8.3624, 124.8624, '2026-08-28 02:00:00', 'Refuel and rest'),
  (19, 3, 'delivery', 'Zamboanga Convention Center', 'Zamboanga City', 6.9214, 122.0790, '2026-08-28 10:00:00', 'Deliver to loading dock')

ON DUPLICATE KEY UPDATE location_name = VALUES(location_name);

-- ============================================================
-- 7. TRIP ASSIGNMENTS (for assigned, released, in_transit, delivered, closed trips)
-- ============================================================
INSERT INTO trip_assignments (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id, assigned_by, is_current, status, created_at) VALUES
  -- Assigned trips
  (1, 1, 12, 1, 1, 1, TRUE, 'assigned', '2026-08-26 08:00:00'),
  (1, 1, 13, 2, 6, 1, TRUE, 'assigned', '2026-08-26 09:00:00'),
  (1, 1, 14, 3, 9, 1, TRUE, 'assigned', '2026-08-25 11:00:00'),

  -- Released trips
  (1, 1, 15, 4, 4, 1, TRUE, 'released', '2026-08-24 10:00:00'),
  (1, 1, 16, 5, 5, 1, TRUE, 'released', '2026-08-23 09:00:00'),

  -- In-transit trips
  (1, 1, 17, 6, 3, 1, TRUE, 'completed', '2026-08-22 08:00:00'),
  (1, 1, 18, 7, 7, 1, TRUE, 'completed', '2026-08-21 10:00:00'),
  (1, 1, 19, 8, 2, 1, TRUE, 'completed', '2026-08-20 09:00:00'),

  -- Delivered trips
  (1, 1, 20, 9, 6, 1, TRUE, 'completed', '2026-08-25 08:00:00'),
  (1, 1, 21, 10, 10, 1, TRUE, 'completed', '2026-08-24 09:00:00'),
  (1, 1, 22, 1, 4, 1, TRUE, 'completed', '2026-08-23 07:00:00'),

  -- Operationally closed trips
  (1, 1, 23, 2, 1, 1, TRUE, 'completed', '2026-08-19 09:00:00'),
  (1, 1, 24, 3, 3, 1, TRUE, 'completed', '2026-08-18 08:00:00')

ON DUPLICATE KEY UPDATE status = VALUES(status);

-- ============================================================
-- 8. TRIP STATUS HISTORY
-- ============================================================
INSERT INTO trip_status_history (company_id, branch_id, trip_ticket_id, from_status, to_status, action, remarks, changed_by, created_at) VALUES
  -- Trip 1 (Draft)
  (1, 1, 1, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-25 09:00:00'),

  -- Trip 2 (Draft)
  (1, 1, 2, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-26 10:30:00'),

  -- Trip 3 (Draft)
  (1, 1, 3, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-27 07:15:00'),

  -- Trip 4 (For Validation)
  (1, 1, 4, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-24 14:00:00'),
  (1, 1, 4, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-28 08:00:00'),

  -- Trip 5 (For Validation)
  (1, 1, 5, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-23 11:00:00'),
  (1, 1, 5, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-28 09:30:00'),

  -- Trip 6 (For Approval)
  (1, 1, 6, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-22 10:00:00'),
  (1, 1, 6, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-27 14:00:00'),
  (1, 1, 6, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-27 14:30:00'),

  -- Trip 7 (For Approval)
  (1, 1, 7, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-21 09:00:00'),
  (1, 1, 7, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-27 16:00:00'),
  (1, 1, 7, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-27 16:30:00'),

  -- Trip 8 (For Approval)
  (1, 1, 8, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-20 08:00:00'),
  (1, 1, 8, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-28 10:00:00'),
  (1, 1, 8, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-28 10:30:00'),

  -- Trip 9 (Approved)
  (1, 1, 9, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-19 13:00:00'),
  (1, 1, 9, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-26 11:00:00'),
  (1, 1, 9, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-26 11:30:00'),
  (1, 1, 9, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-27 09:00:00'),

  -- Trip 10 (Approved)
  (1, 1, 10, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-18 10:00:00'),
  (1, 1, 10, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-25 14:00:00'),
  (1, 1, 10, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-25 14:30:00'),
  (1, 1, 10, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-26 10:00:00'),

  -- Trip 11 (Approved)
  (1, 1, 11, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-24 15:00:00'),
  (1, 1, 11, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-27 08:00:00'),
  (1, 1, 11, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-27 08:30:00'),
  (1, 1, 11, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-27 11:00:00'),

  -- Trip 12 (Assigned)
  (1, 1, 12, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-17 11:00:00'),
  (1, 1, 12, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-25 09:00:00'),
  (1, 1, 12, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-25 09:30:00'),
  (1, 1, 12, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-26 08:00:00'),
  (1, 1, 12, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-26 08:30:00'),

  -- Trip 13 (Assigned)
  (1, 1, 13, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-16 14:00:00'),
  (1, 1, 13, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-25 10:00:00'),
  (1, 1, 13, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-25 10:30:00'),
  (1, 1, 13, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-26 09:00:00'),
  (1, 1, 13, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-26 09:30:00'),

  -- Trip 14 (Assigned)
  (1, 1, 14, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-15 09:00:00'),
  (1, 1, 14, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-24 16:00:00'),
  (1, 1, 14, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-24 16:30:00'),
  (1, 1, 14, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-25 11:00:00'),
  (1, 1, 14, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-25 11:30:00'),

  -- Trip 15 (Released)
  (1, 1, 15, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-14 10:00:00'),
  (1, 1, 15, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-23 09:00:00'),
  (1, 1, 15, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-23 09:30:00'),
  (1, 1, 15, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-24 10:00:00'),
  (1, 1, 15, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-24 10:30:00'),
  (1, 1, 15, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-28 05:35:00'),

  -- Trip 16 (Released)
  (1, 1, 16, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-13 11:00:00'),
  (1, 1, 16, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-22 08:00:00'),
  (1, 1, 16, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-22 08:30:00'),
  (1, 1, 16, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-23 09:00:00'),
  (1, 1, 16, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-23 09:30:00'),
  (1, 1, 16, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-28 04:10:00'),

  -- Trip 17 (In Transit)
  (1, 1, 17, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-12 14:00:00'),
  (1, 1, 17, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-21 10:00:00'),
  (1, 1, 17, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-21 10:30:00'),
  (1, 1, 17, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-22 08:00:00'),
  (1, 1, 17, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-22 08:30:00'),
  (1, 1, 17, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-28 03:05:00'),
  (1, 1, 17, 'released', 'in_transit', 'START_TRANSIT', 'GPS tracking active', 1, '2026-08-28 03:10:00'),

  -- Trip 18 (In Transit)
  (1, 1, 18, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-11 15:00:00'),
  (1, 1, 18, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-20 09:00:00'),
  (1, 1, 18, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-20 09:30:00'),
  (1, 1, 18, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-21 10:00:00'),
  (1, 1, 18, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-21 10:30:00'),
  (1, 1, 18, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-28 06:02:00'),
  (1, 1, 18, 'released', 'in_transit', 'START_TRANSIT', 'GPS tracking active', 1, '2026-08-28 06:05:00'),

  -- Trip 19 (In Transit)
  (1, 1, 19, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-10 16:00:00'),
  (1, 1, 19, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-19 11:00:00'),
  (1, 1, 19, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-19 11:30:00'),
  (1, 1, 19, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-20 09:00:00'),
  (1, 1, 19, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-20 09:30:00'),
  (1, 1, 19, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-27 22:15:00'),
  (1, 1, 19, 'released', 'in_transit', 'START_TRANSIT', 'GPS tracking active', 1, '2026-08-27 22:20:00'),

  -- Trip 20 (Delivered)
  (1, 1, 20, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-09 10:00:00'),
  (1, 1, 20, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-24 08:00:00'),
  (1, 1, 20, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-24 08:30:00'),
  (1, 1, 20, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-25 08:00:00'),
  (1, 1, 20, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-25 08:30:00'),
  (1, 1, 20, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-27 07:05:00'),
  (1, 1, 20, 'released', 'in_transit', 'START_TRANSIT', 'GPS tracking active', 1, '2026-08-27 07:10:00'),
  (1, 1, 20, 'in_transit', 'delivered', 'CONFIRM_DELIVERY', 'POD signed by John Smith', 1, '2026-08-27 09:45:00'),

  -- Trip 21 (Delivered)
  (1, 1, 21, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-08 11:00:00'),
  (1, 1, 21, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-23 09:00:00'),
  (1, 1, 21, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-23 09:30:00'),
  (1, 1, 21, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-24 09:00:00'),
  (1, 1, 21, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-24 09:30:00'),
  (1, 1, 21, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-26 06:10:00'),
  (1, 1, 21, 'released', 'in_transit', 'START_TRANSIT', 'GPS tracking active', 1, '2026-08-26 06:15:00'),
  (1, 1, 21, 'in_transit', 'delivered', 'CONFIRM_DELIVERY', 'POD signed by Dr. Reyes', 1, '2026-08-26 10:30:00'),

  -- Trip 22 (Delivered)
  (1, 1, 22, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-07 12:00:00'),
  (1, 1, 22, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-22 07:00:00'),
  (1, 1, 22, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-22 07:30:00'),
  (1, 1, 22, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-23 07:00:00'),
  (1, 1, 22, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-23 07:30:00'),
  (1, 1, 22, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-25 08:15:00'),
  (1, 1, 22, 'released', 'in_transit', 'START_TRANSIT', 'GPS tracking active', 1, '2026-08-25 08:20:00'),
  (1, 1, 22, 'in_transit', 'delivered', 'CONFIRM_DELIVERY', 'POD signed by warehouse manager', 1, '2026-08-25 11:45:00'),

  -- Trip 23 (Operationally Closed)
  (1, 1, 23, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-05 10:00:00'),
  (1, 1, 23, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-18 09:00:00'),
  (1, 1, 23, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-18 09:30:00'),
  (1, 1, 23, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-19 09:00:00'),
  (1, 1, 23, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-19 09:30:00'),
  (1, 1, 23, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-20 05:10:00'),
  (1, 1, 23, 'released', 'in_transit', 'START_TRANSIT', 'GPS tracking active', 1, '2026-08-20 05:15:00'),
  (1, 1, 23, 'in_transit', 'delivered', 'CONFIRM_DELIVERY', 'POD signed by receiving officer', 1, '2026-08-20 14:30:00'),
  (1, 1, 23, 'delivered', 'operationally_closed', 'CLOSE_TRIP', 'All documents verified', 2, '2026-08-20 16:00:00'),

  -- Trip 24 (Operationally Closed)
  (1, 1, 24, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-04 11:00:00'),
  (1, 1, 24, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-17 08:00:00'),
  (1, 1, 24, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-17 08:30:00'),
  (1, 1, 24, 'for_approval', 'approved', 'APPROVE_TRIP', NULL, 2, '2026-08-18 08:00:00'),
  (1, 1, 24, 'approved', 'assigned', 'ASSIGN_RESOURCES', NULL, 1, '2026-08-18 08:30:00'),
  (1, 1, 24, 'assigned', 'released', 'RELEASE_TRIP', 'Driver accepted and departed', 1, '2026-08-19 04:15:00'),
  (1, 1, 24, 'released', 'in_transit', 'START_TRANSIT', 'GPS tracking active', 1, '2026-08-19 04:20:00'),
  (1, 1, 24, 'in_transit', 'delivered', 'CONFIRM_DELIVERY', 'POD signed by plant manager', 1, '2026-08-19 15:45:00'),
  (1, 1, 24, 'delivered', 'operationally_closed', 'CLOSE_TRIP', 'All documents verified', 2, '2026-08-19 16:30:00'),

  -- Trip 25 (Rejected)
  (1, 1, 25, NULL, 'draft', 'CREATE_TRIP', NULL, 1, '2026-08-21 13:00:00'),
  (1, 1, 25, 'draft', 'for_validation', 'SUBMIT_TRIP', NULL, 1, '2026-08-26 14:00:00'),
  (1, 1, 25, 'for_validation', 'for_approval', 'VALIDATE_TRIP', NULL, 1, '2026-08-26 14:30:00'),
  (1, 1, 25, 'for_approval', 'rejected', 'REJECT_TRIP', 'Insufficient documentation - Missing purchase order number. Please resubmit with complete documents.', 2, '2026-08-27 10:00:00')

ON DUPLICATE KEY UPDATE action = VALUES(action);

-- ============================================================
-- 9. TRIP TRACKING POINTS (for in-transit trips - realistic GPS data)
-- ============================================================
INSERT INTO trip_tracking_points (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id, latitude, longitude, speed_kph, heading, accuracy_meters, gps_status, recorded_at) VALUES
  -- Trip 17 (Davao to CDO - in transit, currently near Bukidnon)
  (1, 1, 17, 6, 3, 7.0731, 125.4553, 0, 0, 5.0, 'online', '2026-08-28 03:05:00'),
  (1, 1, 17, 6, 3, 7.1500, 125.4200, 65, 315, 4.5, 'online', '2026-08-28 03:20:00'),
  (1, 1, 17, 6, 3, 7.2800, 125.3500, 72, 320, 3.8, 'online', '2026-08-28 03:40:00'),
  (1, 1, 17, 6, 3, 7.4500, 125.2800, 68, 325, 4.2, 'online', '2026-08-28 04:00:00'),
  (1, 1, 17, 6, 3, 7.6200, 125.2100, 75, 330, 3.5, 'online', '2026-08-28 04:30:00'),
  (1, 1, 17, 6, 3, 7.8000, 125.1400, 70, 335, 4.0, 'online', '2026-08-28 05:00:00'),
  (1, 1, 17, 6, 3, 8.0000, 125.0500, 73, 340, 3.2, 'online', '2026-08-28 05:30:00'),
  (1, 1, 17, 6, 3, 8.1500, 124.9500, 68, 345, 4.8, 'online', '2026-08-28 06:00:00'),
  (1, 1, 17, 6, 3, 8.3000, 124.8500, 72, 350, 3.6, 'online', '2026-08-28 06:30:00'),
  (1, 1, 17, 6, 3, 8.4800, 124.6200, 70, 355, 4.1, 'online', '2026-08-28 07:00:00'),

  -- Trip 18 (Davao to GenSan - in transit, currently near Digos)
  (1, 1, 18, 7, 7, 7.0731, 125.4553, 0, 0, 5.2, 'online', '2026-08-28 06:02:00'),
  (1, 1, 18, 7, 7, 6.9800, 125.4100, 55, 180, 4.8, 'online', '2026-08-28 06:15:00'),
  (1, 1, 18, 7, 7, 6.8500, 125.3800, 60, 185, 3.9, 'online', '2026-08-28 06:30:00'),
  (1, 1, 18, 7, 7, 6.7200, 125.3500, 58, 190, 4.5, 'online', '2026-08-28 06:45:00'),
  (1, 1, 18, 7, 7, 6.6000, 125.3200, 62, 195, 3.7, 'online', '2026-08-28 07:00:00'),
  (1, 1, 18, 7, 7, 6.5000, 125.2900, 57, 200, 4.2, 'online', '2026-08-28 07:15:00'),

  -- Trip 19 (Davao to Zamboanga - in transit, currently near Pagadian)
  (1, 1, 19, 8, 2, 7.0731, 125.4553, 0, 0, 5.0, 'online', '2026-08-27 22:15:00'),
  (1, 1, 19, 8, 2, 7.2000, 125.1000, 65, 270, 4.5, 'online', '2026-08-27 22:45:00'),
  (1, 1, 19, 8, 2, 7.3500, 124.8000, 70, 275, 3.8, 'online', '2026-08-27 23:15:00'),
  (1, 1, 19, 8, 2, 7.5500, 124.5000, 68, 280, 4.2, 'online', '2026-08-27 23:45:00'),
  (1, 1, 19, 8, 2, 7.7500, 124.2000, 72, 285, 3.5, 'online', '2026-08-28 00:15:00'),
  (1, 1, 19, 8, 2, 7.8500, 123.9000, 65, 290, 4.0, 'online', '2026-08-28 00:45:00'),
  (1, 1, 19, 8, 2, 7.6500, 123.5000, 70, 295, 3.8, 'online', '2026-08-28 01:15:00'),
  (1, 1, 19, 8, 2, 7.4500, 123.1000, 68, 300, 4.5, 'online', '2026-08-28 01:45:00'),
  (1, 1, 19, 8, 2, 7.2500, 122.8000, 72, 305, 3.2, 'online', '2026-08-28 02:15:00'),
  (1, 1, 19, 8, 2, 7.0500, 122.5000, 65, 310, 4.8, 'online', '2026-08-28 02:45:00')

ON DUPLICATE KEY UPDATE latitude = VALUES(latitude);

-- ============================================================
-- 10. APPROVAL ACTIONS
-- ============================================================
INSERT INTO approval_actions (company_id, branch_id, trip_ticket_id, action, reason, acted_by, created_at) VALUES
  -- Trip 6
  (1, 1, 6, 'submitted', NULL, 1, '2026-08-27 14:00:00'),
  (1, 1, 6, 'validated', NULL, 1, '2026-08-27 14:30:00'),

  -- Trip 7
  (1, 1, 7, 'submitted', NULL, 1, '2026-08-27 16:00:00'),
  (1, 1, 7, 'validated', NULL, 1, '2026-08-27 16:30:00'),

  -- Trip 8
  (1, 1, 8, 'submitted', NULL, 1, '2026-08-28 10:00:00'),
  (1, 1, 8, 'validated', NULL, 1, '2026-08-28 10:30:00'),

  -- Trip 9
  (1, 1, 9, 'submitted', NULL, 1, '2026-08-26 11:00:00'),
  (1, 1, 9, 'validated', NULL, 1, '2026-08-26 11:30:00'),
  (1, 1, 9, 'approved', NULL, 2, '2026-08-27 09:00:00'),

  -- Trip 10
  (1, 1, 10, 'submitted', NULL, 1, '2026-08-25 14:00:00'),
  (1, 1, 10, 'validated', NULL, 1, '2026-08-25 14:30:00'),
  (1, 1, 10, 'approved', NULL, 2, '2026-08-26 10:00:00'),

  -- Trip 11
  (1, 1, 11, 'submitted', NULL, 1, '2026-08-27 08:00:00'),
  (1, 1, 11, 'validated', NULL, 1, '2026-08-27 08:30:00'),
  (1, 1, 11, 'approved', NULL, 2, '2026-08-27 11:00:00'),

  -- Trip 12
  (1, 1, 12, 'submitted', NULL, 1, '2026-08-25 09:00:00'),
  (1, 1, 12, 'validated', NULL, 1, '2026-08-25 09:30:00'),
  (1, 1, 12, 'approved', NULL, 2, '2026-08-26 08:00:00'),

  -- Trip 13
  (1, 1, 13, 'submitted', NULL, 1, '2026-08-25 10:00:00'),
  (1, 1, 13, 'validated', NULL, 1, '2026-08-25 10:30:00'),
  (1, 1, 13, 'approved', NULL, 2, '2026-08-26 09:00:00'),

  -- Trip 14
  (1, 1, 14, 'submitted', NULL, 1, '2026-08-24 16:00:00'),
  (1, 1, 14, 'validated', NULL, 1, '2026-08-24 16:30:00'),
  (1, 1, 14, 'approved', NULL, 2, '2026-08-25 11:00:00'),

  -- Trip 25 (Rejected)
  (1, 1, 25, 'submitted', NULL, 1, '2026-08-26 14:00:00'),
  (1, 1, 25, 'validated', NULL, 1, '2026-08-26 14:30:00'),
  (1, 1, 25, 'rejected', 'Insufficient documentation - Missing purchase order number. Please resubmit with complete documents.', 2, '2026-08-27 10:00:00')

ON DUPLICATE KEY UPDATE action = VALUES(action);

-- ============================================================
-- 11. OPERATIONAL EXCEPTIONS
-- ============================================================
INSERT INTO operational_exceptions (company_id, branch_id, trip_ticket_id, exception_type, severity, title, description, latitude, longitude, status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution_notes, detected_at) VALUES
  -- Open exceptions
  (1, 1, 17, 'trip_delay', 'warning', 'Trip Delayed - Traffic Congestion', 'Heavy traffic encountered at Bukidnon highway section. Estimated 30-minute delay to destination.', 8.0000, 125.0500, 'open', NULL, NULL, NULL, NULL, NULL, '2026-08-28 05:30:00'),

  (1, 1, 18, 'route_deviation', 'critical', 'Route Deviation Detected', 'Vehicle deviated from planned route by 2.5km. Driver reports road closure due to construction.', 6.7200, 125.3500, 'open', NULL, NULL, NULL, NULL, NULL, '2026-08-28 06:45:00'),

  (1, 1, NULL, 'vehicle_maintenance_block', 'warning', 'Vehicle ABC 1236 Maintenance Due', 'Vehicle ABC 1236 (Refrigerated Van) is due for preventive maintenance in 3 days. Schedule maintenance to avoid trip disruptions.', NULL, NULL, 'open', NULL, NULL, NULL, NULL, NULL, '2026-08-28 08:00:00'),

  -- Acknowledged exceptions
  (1, 1, 19, 'gps_offline', 'warning', 'GPS Signal Intermittent', 'GPS signal lost for 15 minutes near Pagadian area. Driver reports entering tunnel zone.', 7.5500, 124.5000, 'acknowledged', 1, '2026-08-28 01:30:00', NULL, NULL, NULL, '2026-08-28 01:15:00'),

  (1, 1, NULL, 'driver_license_issue', 'info', 'Driver License Expiring Soon', 'Driver Roberto Fernandez (DRV-009) license expires on October 28, 2026. Schedule renewal before expiry.', NULL, NULL, 'acknowledged', 1, '2026-08-27 09:00:00', NULL, NULL, NULL, '2026-08-26 14:00:00'),

  -- Resolved exceptions
  (1, 1, 15, 'cargo_damage', 'critical', 'Minor Cargo Damage Reported', '2 boxes of marketing materials damaged during unloading. Client notified and replacement arranged.', 7.5000, 125.2000, 'resolved', 1, '2026-08-28 06:00:00', 2, '2026-08-28 08:00:00', 'Replacement shipped via next available trip. Client compensated with 10% discount on next order.', '2026-08-28 05:45:00'),

  (1, 1, 16, 'failed_delivery', 'warning', 'Delivery Attempt Failed', 'Recipient not available at delivery address. Package returned to driver for re-delivery.', 8.1500, 125.0924, 'resolved', 1, '2026-08-28 04:30:00', 1, '2026-08-28 05:00:00', 'Re-delivery scheduled for tomorrow 8AM. Contact recipient to confirm availability.', '2026-08-28 04:15:00'),

  (1, 1, NULL, 'schedule_conflict', 'info', 'Schedule Overlap Detected', 'Driver Juan Dela Cruz has overlapping trip assignments on Aug 30. Review and resolve conflict.', NULL, NULL, 'resolved', 1, '2026-08-27 10:00:00', 2, '2026-08-27 14:00:00', 'Reassigned Trip 10 to Driver Pedro Santos. Updated dispatch records.', '2026-08-27 09:00:00')

ON DUPLICATE KEY UPDATE title = VALUES(title);

-- ============================================================
-- 12. ADDITIONAL USERS (for multi-user approval workflow)
-- ============================================================
INSERT INTO users (user_id, email, password_hash, first_name, last_name, status) VALUES
  (3, 'dispatcher@astreablue.com', '$2b$10$rQEY5zG1G1G1G1G1G1G1GuQxQxQxQxQxQxQxQxQxQxQxQxQxQxQx', 'Maria', 'Santos', 'active'),
  (4, 'approver@astreablue.com', '$2b$10$rQEY5zG1G1G1G1G1G1G1GuQxQxQxQxQxQxQxQxQxQxQxQxQxQxQx', 'Roberto', 'Reyes', 'active')
ON DUPLICATE KEY UPDATE email = VALUES(email);

INSERT INTO user_company_access (user_id, company_id, branch_id, status) VALUES
  (3, 1, 1, 'active'),
  (4, 1, 1, 'active')
ON DUPLICATE KEY UPDATE status = VALUES(status);

-- Add Dispatcher and Approver roles
INSERT INTO roles (company_id, role_name, status) VALUES
  (1, 'Dispatcher', 'active'),
  (1, 'Approver', 'active')
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name);

-- Assign roles to users
INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status)
SELECT 3, role_id, 1, 1, 'active'
FROM roles WHERE company_id = 1 AND role_name = 'Dispatcher'
ON DUPLICATE KEY UPDATE status = VALUES(status);

INSERT INTO user_roles (user_id, role_id, company_id, branch_id, status)
SELECT 4, role_id, 1, 1, 'active'
FROM roles WHERE company_id = 1 AND role_name = 'Approver'
ON DUPLICATE KEY UPDATE status = VALUES(status);

-- Grant permissions to Dispatcher role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.company_id = 1 AND r.role_name = 'Dispatcher'
  AND p.permission_code IN ('trip.read', 'trip.create', 'trip.submit', 'tracking.read', 'tracking.update', 'exception.read', 'exception.create', 'customer.read')
ON DUPLICATE KEY UPDATE permission_id = permission_id;

-- Grant permissions to Approver role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.company_id = 1 AND r.role_name = 'Approver'
  AND p.permission_code IN ('trip.read', 'trip.validate', 'trip.approve', 'trip.assign', 'tracking.read', 'exception.read', 'exception.resolve', 'customer.read')
ON DUPLICATE KEY UPDATE permission_id = permission_id;

-- ============================================================
-- SUMMARY OF SEEDED DATA
-- ============================================================
-- Companies: 1 (AstreaBlue Logistics)
-- Branches: 3 (Davao, Cebu, General Santos)
-- Users: 4 (Admin, Driver, Dispatcher, Approver)
-- Drivers: 10 (all active)
-- Vehicles: 10 (all active)
-- Customers: 5 (already seeded in 001_operations_tables.sql)
--
-- Trip Tickets: 25 total
--   - Draft: 3 (trips 1-3)
--   - For Validation: 2 (trips 4-5)
--   - For Approval: 3 (trips 6-8)
--   - Approved: 3 (trips 9-11)
--   - Assigned: 3 (trips 12-14)
--   - Released: 2 (trips 15-16)
--   - In Transit: 3 (trips 17-19)
--   - Delivered: 3 (trips 20-22)
--   - Operationally Closed: 2 (trips 23-24)
--   - Rejected: 1 (trip 25)
--
-- Trip Stops: 10 (for multi-stop trips)
-- Trip Assignments: 13
-- Trip Status History: 100+ records
-- Trip Tracking Points: 25 (GPS data for in-transit trips)
-- Approval Actions: 20
-- Operational Exceptions: 8 (3 open, 2 acknowledged, 3 resolved)
-- ============================================================
