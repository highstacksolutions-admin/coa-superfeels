-- Super Feels COA — initial schema
-- MySQL 8 / MariaDB 10.5+. utf8mb4 throughout.

CREATE TABLE IF NOT EXISTS admins (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  -- editor may manage products, batches and results; admin also gets people,
  -- enquiries, analytics and system.
  role          ENUM('admin','editor') NOT NULL DEFAULT 'editor',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS labs (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(160) NOT NULL,
  slug          VARCHAR(160) NOT NULL,
  license_no    VARCHAR(80)  NULL,
  accreditation VARCHAR(160) NULL,
  website       VARCHAR(255) NULL,
  contact_email VARCHAR(190) NULL,
  phone         VARCHAR(40)  NULL,
  address       VARCHAR(255) NULL,
  notes         TEXT         NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_labs_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(200) NOT NULL,
  slug         VARCHAR(200) NOT NULL,
  sku          VARCHAR(80)  NULL,
  category     VARCHAR(80)  NOT NULL DEFAULT '',
  size_label   VARCHAR(80)  NULL,
  description  TEXT         NULL,
  image_path   VARCHAR(255) NULL,
  sort_order   INT          NOT NULL DEFAULT 0,
  is_published TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug (slug),
  KEY idx_products_order (sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS batches (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id   INT UNSIGNED NOT NULL,
  lab_id       INT UNSIGNED NULL,

  -- Two columns for one code, on purpose.
  --
  -- batch_code is the display form, exactly as it is printed on the product:
  -- "SF-2409-A12". batch_key is that code reduced to letters and digits —
  -- "SF2409A12" — and it is what every lookup matches on, because a customer
  -- reading a label off a jar will not reproduce the punctuation.
  --
  -- The UNIQUE index is on the key rather than the display code so that
  -- "SF-2409-A12" and "SF2409A12" cannot both exist as separate batches and
  -- then race each other in a lookup. See src/lib/validate.js#batchKey.
  batch_code   VARCHAR(80)  NOT NULL,
  batch_key    VARCHAR(80)  NOT NULL,

  status       ENUM('pass','fail','pending') NOT NULL DEFAULT 'pending',
  lab_sample_id VARCHAR(80) NULL,
  manufactured_on DATE      NULL,
  tested_on    DATE         NULL,
  expires_on   DATE         NULL,

  -- The two numbers the package itself advertises, kept on the batch so the
  -- lookup result can show them without reading the whole results table.
  total_thc    DECIMAL(8,3) NULL,
  total_cbd    DECIMAL(8,3) NULL,
  potency_unit VARCHAR(12)  NOT NULL DEFAULT '%',

  notes        TEXT         NULL,
  is_published TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_batches_key (batch_key),
  KEY idx_batches_product (product_id),
  KEY idx_batches_published (is_published, tested_on),
  KEY idx_batches_lab (lab_id),
  CONSTRAINT fk_batches_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  -- A lab can be retired without taking its historical batches with it.
  CONSTRAINT fk_batches_lab FOREIGN KEY (lab_id)
    REFERENCES labs (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coa_files (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id          INT UNSIGNED NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename   VARCHAR(255) NOT NULL,
  -- Path relative to STORAGE_PATH. Storing it relative means the storage root
  -- can move between environments without rewriting every row.
  file_path         VARCHAR(500) NOT NULL,
  mime_type         VARCHAR(160) NOT NULL,
  file_size         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  label             VARCHAR(120) NULL,
  is_primary        TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order        INT          NOT NULL DEFAULT 0,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coa_files_stored (stored_filename),
  KEY idx_coa_files_batch (batch_id, sort_order, id),
  CONSTRAINT fk_coa_files_batch FOREIGN KEY (batch_id)
    REFERENCES batches (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS result_panels (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id   INT UNSIGNED NOT NULL,
  panel      ENUM('cannabinoids','terpenes','pesticides','heavy_metals','microbials',
                  'mycotoxins','residual_solvents','water_activity','foreign_matter') NOT NULL,
  status     ENUM('pass','fail','not_tested') NOT NULL DEFAULT 'not_tested',
  method     VARCHAR(120) NULL,
  summary    VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One row per panel per batch. Without this a double-submitted results form
  -- silently produces two "Pesticides" sections that disagree.
  UNIQUE KEY uq_result_panels_batch_panel (batch_id, panel),
  CONSTRAINT fk_result_panels_batch FOREIGN KEY (batch_id)
    REFERENCES batches (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS results (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  panel_id      INT UNSIGNED NOT NULL,
  analyte       VARCHAR(120) NOT NULL,
  -- The value as the lab printed it, so "ND", "<LOQ" and "0.021" all survive
  -- unchanged. numeric_value carries the same figure when there is one, for
  -- sorting and for the charts; it is NULL for the non-numeric cases.
  value_text    VARCHAR(40)  NOT NULL DEFAULT '',
  numeric_value DECIMAL(14,5) NULL,
  unit          VARCHAR(20)  NULL,
  lod           VARCHAR(20)  NULL,
  loq           VARCHAR(20)  NULL,
  limit_text    VARCHAR(40)  NULL,
  status        ENUM('pass','fail','nd','na') NOT NULL DEFAULT 'na',
  sort_order    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_results_panel (panel_id, sort_order, id),
  CONSTRAINT fk_results_panel FOREIGN KEY (panel_id)
    REFERENCES result_panels (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every batch lookup, hit or miss. The misses are the valuable half: each one
-- is a label that does not match the database, a batch nobody published, or a
-- code that was never ours.
CREATE TABLE IF NOT EXISTS lookups (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  query      VARCHAR(80)  NOT NULL DEFAULT '',
  batch_id   INT UNSIGNED NULL,
  found      TINYINT(1)   NOT NULL DEFAULT 0,
  source     ENUM('form','link','qr') NOT NULL DEFAULT 'form',
  ip_address VARCHAR(45)  NULL,
  user_agent VARCHAR(255) NULL,
  referrer   VARCHAR(255) NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lookups_when (created_at),
  KEY idx_lookups_found (found, created_at),
  KEY idx_lookups_query (query),
  KEY idx_lookups_batch (batch_id),
  -- SET NULL, not CASCADE: deleting a batch must not erase the lookup history
  -- the analytics are built from.
  CONSTRAINT fk_lookups_batch FOREIGN KEY (batch_id)
    REFERENCES batches (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coa_downloads (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  coa_file_id INT UNSIGNED NULL,
  batch_id    INT UNSIGNED NULL,
  ip_address  VARCHAR(45)  NULL,
  user_agent  VARCHAR(255) NULL,
  referrer    VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_coa_downloads_when (created_at),
  KEY idx_coa_downloads_file (coa_file_id),
  KEY idx_coa_downloads_batch (batch_id),
  CONSTRAINT fk_coa_downloads_file FOREIGN KEY (coa_file_id)
    REFERENCES coa_files (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_coa_downloads_batch FOREIGN KEY (batch_id)
    REFERENCES batches (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enquiries (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(190) NOT NULL,
  batch_code  VARCHAR(80)  NULL,
  subject     VARCHAR(160) NULL,
  message     TEXT         NOT NULL,
  status      ENUM('new','read','resolved') NOT NULL DEFAULT 'new',
  ip_address  VARCHAR(45)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME     NULL,
  resolved_by INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_enquiries_status (status, created_at),
  KEY idx_enquiries_when (created_at),
  CONSTRAINT fk_enquiries_admin FOREIGN KEY (resolved_by)
    REFERENCES admins (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Editable static content. Keyed by slug so more pages can be added from the
-- admin without a migration.
CREATE TABLE IF NOT EXISTS content_pages (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug             VARCHAR(120) NOT NULL,
  title            VARCHAR(200) NOT NULL,
  meta_description VARCHAR(255) NULL,
  body             MEDIUMTEXT   NOT NULL,
  is_published     TINYINT(1)   NOT NULL DEFAULT 1,
  show_in_nav      TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order       INT          NOT NULL DEFAULT 0,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_content_pages_slug (slug),
  KEY idx_content_pages_nav (show_in_nav, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff audit trail. A published lab result is a compliance artefact, so "who
-- changed this batch and when" has to be answerable months later.
CREATE TABLE IF NOT EXISTS activity_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id   INT UNSIGNED NULL,
  action     VARCHAR(80)  NOT NULL,
  entity     VARCHAR(60)  NOT NULL,
  entity_id  INT UNSIGNED NULL,
  detail     VARCHAR(500) NULL,
  ip_address VARCHAR(45)  NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_when (created_at),
  KEY idx_activity_entity (entity, entity_id),
  -- The trail outlives the account. Deleting a staff member must not rewrite
  -- the history of what they did.
  CONSTRAINT fk_activity_admin FOREIGN KEY (admin_id)
    REFERENCES admins (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Operator-editable settings, so the copy on the public pages and the contact
-- address are not redeploys.
CREATE TABLE IF NOT EXISTS settings (
  name       VARCHAR(80)  NOT NULL,
  value      TEXT         NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- express-mysql-session's tables. Created explicitly so the schema is in the
-- migrations rather than being auto-created on first boot.
--
-- The public site has no accounts; its session exists only to carry the CSRF
-- secret for the contact form and one flash message. The admin panel gets its
-- own cookie AND its own table, so a session on the public side grants nothing
-- in the admin and signing out of one does not touch the other.
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires    INT(11) UNSIGNED NOT NULL,
  data       MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS admin_sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires    INT(11) UNSIGNED NOT NULL,
  data       MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
