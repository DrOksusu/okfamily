const User = require('./User');
const Vault = require('./Vault');

// Define associations
User.hasOne(Vault, {
    foreignKey: 'userId',
    as: 'vault',
    onDelete: 'CASCADE'
});

Vault.belongsTo(User, {
    foreignKey: 'userId',
    as: 'user'
});

module.exports = {
    User,
    Vault
};
