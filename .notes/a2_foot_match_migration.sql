-- ============================================================
-- A2 auto-settlement: foot_match enrich-at-finalize columns
-- ============================================================
-- Added 2026-06-11.  Mirrors the apisports_* ALTER pattern (those cols
-- are also not in the 2026-05-21 schemas.sql dump; they were added live).
--
-- Populated by goalserve_a2_enrich.enrich_finished_a2() once a match is
-- finalised (is_inball=1), from the Goalserve soccerfixtures feed.  Read by
-- settle_bets.php PRIORITY-0 and graded in settle_graders.php (A2 markets).
--
-- ENGINE=MyISAM (matches foot_match); all nullable so a row with no enrich
-- data grades A2 markets as null => manual (never auto-mis-grade).
--
-- IDEMPOTENT: re-running ADD COLUMN errors if the column exists; run each
-- line guarded, or use the python migrate helper which checks INFORMATION_SCHEMA.

ALTER TABLE `foot_match`
  ADD COLUMN `gs_timeline`   MEDIUMTEXT   DEFAULT NULL COMMENT 'A2: JSON goal/card/sub timeline from soccerfixtures',
  ADD COLUMN `gs_ft_h`       INT(11)      DEFAULT NULL COMMENT 'A2: 90-min regulation score home',
  ADD COLUMN `gs_ft_c`       INT(11)      DEFAULT NULL COMMENT 'A2: 90-min regulation score away',
  ADD COLUMN `gs_et_h`       INT(11)      DEFAULT NULL COMMENT 'A2: extra-time score home (NULL if no ET)',
  ADD COLUMN `gs_et_c`       INT(11)      DEFAULT NULL COMMENT 'A2: extra-time score away (NULL if no ET)',
  ADD COLUMN `gs_pen_h`      INT(11)      DEFAULT NULL COMMENT 'A2: penalty shootout score home (NULL if no PEN)',
  ADD COLUMN `gs_pen_c`      INT(11)      DEFAULT NULL COMMENT 'A2: penalty shootout score away (NULL if no PEN)',
  ADD COLUMN `gs_decider`    VARCHAR(10)  DEFAULT NULL COMMENT 'A2: REG | ET | PEN',
  ADD COLUMN `gs_enrich_at`  BIGINT(20)   DEFAULT NULL COMMENT 'A2: epoch when enrich last ran (NULL=never)',
  ADD COLUMN `gs_enrich_st`  VARCHAR(10)  DEFAULT NULL COMMENT 'A2: enrich status: ok | unmapped | nodata';

-- Helps the enrich sweep find rows still needing enrichment.
ALTER TABLE `foot_match` ADD KEY `gs_enrich` (`is_inball`,`gs_enrich_at`);
