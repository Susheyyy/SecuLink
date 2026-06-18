import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export class File extends Model {
  declare id: string;
  declare fileName: string;
  declare fileHash: string;
  declare passwordHash: string | null;
  declare encryptionKey: string;
  declare encryptionIv: string;
  declare authTag: string;
  declare mimeType: string;
  declare fileSize: number;
  declare expiresAt: Date;
  declare downloadCount: number;
  declare maxDownloads: number | null;
  declare isDeleted: boolean;
  declare allowedIp: string | null;
  declare notificationEmail: string | null;
  declare isDirect: boolean;
  declare allowedCountries: string | null;
  declare accessWindowStart: string | null;
  declare accessWindowEnd: string | null;
  declare shareType: string;
  declare cryptoSalt: string | null;
  declare recipientEmail: string | null;
  declare otpCode: string | null;
  declare otpExpiresAt: Date | null;
  declare viewOnly: boolean;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

File.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    fileName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    fileHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    encryptionKey: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    encryptionIv: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    authTag: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    mimeType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    fileSize: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    downloadCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    maxDownloads: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    allowedIp: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    notificationEmail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isDirect: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    allowedCountries: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    accessWindowStart: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    accessWindowEnd: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    shareType: {
      type: DataTypes.STRING,
      defaultValue: 'file',
      allowNull: false,
    },
    cryptoSalt: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recipientEmail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    otpCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    otpExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    viewOnly: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'files',
  }
);
