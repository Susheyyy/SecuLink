import { File } from './file';
import { AuditLog } from './log';
import { Message } from './message';

File.hasMany(AuditLog, { foreignKey: 'fileId', as: 'logs', onDelete: 'CASCADE' });
AuditLog.belongsTo(File, { foreignKey: 'fileId' });

File.hasMany(Message, { foreignKey: 'fileId', as: 'messages', onDelete: 'CASCADE' });
Message.belongsTo(File, { foreignKey: 'fileId' });

export { File, AuditLog, Message };
export { sequelize } from '../config/database';
