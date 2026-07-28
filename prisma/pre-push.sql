-- 一次性数据库清理脚本
-- 解决 User → LokiUser 重命名导致的外键约束冲突
-- 部署成功后应从 build 脚本中移除

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `LoginRecord`;
DROP TABLE IF EXISTS `Session`;
DROP TABLE IF EXISTS `Heartbeat`;
DROP TABLE IF EXISTS `Friend`;
DROP TABLE IF EXISTS `FriendRequest`;
DROP TABLE IF EXISTS `LokiUser`;
DROP TABLE IF EXISTS `User`;
DROP TABLE IF EXISTS `AdminUser`;
DROP TABLE IF EXISTS `ProgramConfig`;
DROP TABLE IF EXISTS `CodePackage`;
DROP TABLE IF EXISTS `AuditLog`;

SET FOREIGN_KEY_CHECKS = 1;
