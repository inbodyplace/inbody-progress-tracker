CREATE DATABASE IF NOT EXISTS inbody_progress_tracker
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE inbody_progress_tracker;

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS measurements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inbody_user_id VARCHAR(50) NOT NULL,
  tel_hp VARCHAR(20) NULL,
  test_at CHAR(14) NOT NULL,
  smm DECIMAL(5,1) NULL,
  bfm DECIMAL(5,1) NULL,
  pbf DECIMAL(4,1) NULL,
  vfa_level TINYINT NULL,
  bmr SMALLINT NULL,
  status ENUM('pending', 'success', 'error', 'skipped_temp') NOT NULL DEFAULT 'pending',
  error_message VARCHAR(255) NULL,
  customer_id INT NULL,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE (inbody_user_id, test_at),
  INDEX (tel_hp),
  INDEX (customer_id),
  CONSTRAINT fk_measurements_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
  usage_date DATE PRIMARY KEY,
  call_count INT NOT NULL DEFAULT 0
);
