-- Run once by the mysql image on first start. One database per service.
CREATE DATABASE IF NOT EXISTS slack_auth;
CREATE DATABASE IF NOT EXISTS slack_admin;
GRANT ALL PRIVILEGES ON slack_auth.* TO 'slack'@'%';
GRANT ALL PRIVILEGES ON slack_admin.* TO 'slack'@'%';
FLUSH PRIVILEGES;
