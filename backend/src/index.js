require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const sequelize = require('./config/database');
require('./models'); // Load models and associations
const authRoutes = require('./routes/auth');
const vaultRoutes = require('./routes/vault');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for Railway, Heroku, etc.)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5500',
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }
});
app.use(limiter);

// Auth specific rate limiter (stricter)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 login attempts per windowMs
    message: { error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.' }
});

// Body parser
app.use(express.json({ limit: '10mb' }));

// Health check (root path for Railway healthcheck)
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'Password Manager API' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/vault', vaultRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({
        error: process.env.NODE_ENV === 'development'
            ? err.message
            : '서버 오류가 발생했습니다.'
    });
});

// Database connection and server start
async function startServer() {
    try {
        await sequelize.authenticate();
        console.log('Database connected successfully.');

        // Sync models (create tables if not exist)
        await sequelize.sync();
        console.log('Database synced.');

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Unable to start server:', error);
        process.exit(1);
    }
}

startServer();
