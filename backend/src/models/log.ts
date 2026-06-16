import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class AuditLog extends Model {
  declare id: number;
  declare fileId: string;
  declare action: string; 
  declare ipAddress: string;
  declare details: string;
  declare readonly createdAt: Date;
}

AuditLog.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    fileId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    details: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'audit_logs',
    updatedAt: false, 
  }
);
