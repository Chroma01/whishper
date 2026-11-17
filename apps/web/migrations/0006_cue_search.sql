-- Full-text search over cue text. Drizzle cannot describe FTS5 tables, so
-- they live only here and the schema leaves them alone.
--
-- remove_diacritics 2 folds every Latin accent, and the prefix indexes keep
-- search-as-you-type fast. The index keys rows by its own integer, and
-- cue_search_rows maps them to cues: the rowid of cues itself can change when
-- SQLite rebuilds the table.
CREATE VIRTUAL TABLE `cue_search` USING fts5(
  `text`,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
--> statement-breakpoint
CREATE TABLE `cue_search_rows` (
  `rowid` integer PRIMARY KEY,
  `cue_id` text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TRIGGER `cues_search_insert` AFTER INSERT ON `cues` BEGIN
  INSERT INTO `cue_search_rows` (`cue_id`) VALUES (new.`id`);
  INSERT INTO `cue_search` (`rowid`, `text`)
    VALUES ((SELECT `rowid` FROM `cue_search_rows` WHERE `cue_id` = new.`id`), new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `cues_search_update` AFTER UPDATE OF `text` ON `cues` BEGIN
  UPDATE `cue_search` SET `text` = new.`text`
    WHERE `rowid` = (SELECT `rowid` FROM `cue_search_rows` WHERE `cue_id` = old.`id`);
END;
--> statement-breakpoint
CREATE TRIGGER `cues_search_delete` AFTER DELETE ON `cues` BEGIN
  DELETE FROM `cue_search`
    WHERE `rowid` = (SELECT `rowid` FROM `cue_search_rows` WHERE `cue_id` = old.`id`);
  DELETE FROM `cue_search_rows` WHERE `cue_id` = old.`id`;
END;
--> statement-breakpoint
INSERT INTO `cue_search_rows` (`cue_id`) SELECT `id` FROM `cues`;
--> statement-breakpoint
INSERT INTO `cue_search` (`rowid`, `text`)
  SELECT `cue_search_rows`.`rowid`, `cues`.`text`
  FROM `cues` JOIN `cue_search_rows` ON `cue_search_rows`.`cue_id` = `cues`.`id`;
