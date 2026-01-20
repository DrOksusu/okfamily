const { Sequelize } = require('sequelize');

// DATABASE_URL 사용 (mysql://user:password@host:port/database)
const sequelizeOptions = {
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
    },
    define: {
        timestamps: true,
        underscored: true
    }
};

// SSL 설정 (Railway 내부 연결은 SSL 불필요)
if (process.env.DB_SSL === 'true') {
    sequelizeOptions.dialectOptions = {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    };
}

const sequelize = new Sequelize(process.env.DATABASE_URL, sequelizeOptions);

module.exports = sequelize;
