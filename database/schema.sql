CREATE DATABASE IF NOT EXISTS cruddb;
USE cruddb;

CREATE TABLE IF NOT EXISTS items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(150) NOT NULL,
  description   TEXT,
  file_name     VARCHAR(255) NULL,   -- stored (random) file name on backend disk
  original_name VARCHAR(255) NULL,   -- name of the file as uploaded by the user
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
