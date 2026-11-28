import { describe, expect, it } from 'vitest';
import { CURRENT_BACKUP_VERSION, resolveBackupVersion } from '../services/exportService';

describe('备份版本分流', () => {
  it('缺省版本号按最早的旧版处理（v7）', () => {
    expect(resolveBackupVersion({})).toBe(7);
    expect(resolveBackupVersion({ backupVersion: undefined })).toBe(7);
    expect(resolveBackupVersion({ backupVersion: null })).toBe(7);
  });

  it('识别正常的版本号', () => {
    expect(resolveBackupVersion({ backupVersion: 7 })).toBe(7);
    expect(resolveBackupVersion({ backupVersion: 8 })).toBe(8);
    expect(resolveBackupVersion({ backupVersion: '8' })).toBe(8);
  });

  it('版本号无法识别时判定为损坏，而不是当成旧版迁移', () => {
    expect(() => resolveBackupVersion({ backupVersion: '8abc' })).toThrow(/损坏/);
    expect(() => resolveBackupVersion({ backupVersion: 0 })).toThrow(/损坏/);
    expect(() => resolveBackupVersion({ backupVersion: -3 })).toThrow(/损坏/);
    expect(() => resolveBackupVersion({ backupVersion: 7.5 })).toThrow(/损坏/);
    expect(() => resolveBackupVersion({ backupVersion: { v: 8 } })).toThrow(/损坏/);
  });

  it('当前版本常量与导出写入口径一致', () => {
    expect(CURRENT_BACKUP_VERSION).toBe(8);
  });
});
