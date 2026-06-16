import { File } from './file';
import { AuditLog } from './log';

File.hasMany(AuditLog, { foreignKey: 'fileId', as: 'logs', onDelete: 'CASCADE' });
AuditLog.belongsTo(File, { foreignKey: 'fileId' });

export { File, AuditLog };
export { sequelize } from '../config/database';
