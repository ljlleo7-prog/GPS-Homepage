-- Full Database Backup (Data Tables)
-- Created before performing schema re-linking
-- Date: 2026-02-08

-- 1. Profiles & Auth Linked Data
CREATE TABLE IF NOT EXISTS backup_profiles_20260208 AS SELECT * FROM public.profiles;

-- 2. Economy
CREATE TABLE IF NOT EXISTS backup_wallets_20260208 AS SELECT * FROM public.wallets;
CREATE TABLE IF NOT EXISTS backup_ledger_entries_20260208 AS SELECT * FROM public.ledger_entries;
CREATE TABLE IF NOT EXISTS backup_user_ticket_balances_20260208 AS SELECT * FROM public.user_ticket_balances;

-- 3. Social (Forum)
CREATE TABLE IF NOT EXISTS backup_forum_posts_20260208 AS SELECT * FROM public.forum_posts;
CREATE TABLE IF NOT EXISTS backup_forum_comments_20260208 AS SELECT * FROM public.forum_comments;

-- 4. Missions
CREATE TABLE IF NOT EXISTS backup_missions_20260208 AS SELECT * FROM public.missions;
CREATE TABLE IF NOT EXISTS backup_mission_submissions_20260208 AS SELECT * FROM public.mission_submissions;

-- 5. Minigames & Gameplay
CREATE TABLE IF NOT EXISTS backup_minigame_scores_20260208 AS SELECT * FROM public.minigame_scores;
CREATE TABLE IF NOT EXISTS backup_one_lap_leaderboard_20260208 AS SELECT * FROM public.one_lap_leaderboard;
CREATE TABLE IF NOT EXISTS backup_one_lap_drivers_20260208 AS SELECT * FROM public.one_lap_drivers;

-- 6. Support & Requests
CREATE TABLE IF NOT EXISTS backup_support_instruments_20260208 AS SELECT * FROM public.support_instruments;
CREATE TABLE IF NOT EXISTS backup_test_player_requests_20260208 AS SELECT * FROM public.test_player_requests;
