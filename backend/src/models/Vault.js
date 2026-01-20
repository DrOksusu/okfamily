const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Vault = sequelize.define('Vault', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: 'user_id',
        references: {
            model: 'users',
            key: 'id'
        }
    },
    masterHash: {
        type: DataTypes.STRING(500),
        allowNull: false,
        field: 'master_hash'
    },
    encryptedData: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
        field: 'encrypted_data'
    }
}, {
    tableName: 'vaults',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});

module.exports = Vault;
