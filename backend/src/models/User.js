const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
            isEmail: {
                msg: '유효한 이메일 주소를 입력하세요.'
            }
        }
    },
    passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'password_hash'
    }
}, {
    tableName: 'users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
});

// Hash password before saving
User.beforeCreate(async (user) => {
    if (user.passwordHash) {
        user.passwordHash = await bcrypt.hash(user.passwordHash, 12);
    }
});

// Instance method to check password
User.prototype.checkPassword = async function(password) {
    return bcrypt.compare(password, this.passwordHash);
};

// Don't return password hash in JSON
User.prototype.toJSON = function() {
    const values = { ...this.get() };
    delete values.passwordHash;
    return values;
};

module.exports = User;
