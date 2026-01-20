const express = require('express');
const jwt = require('jsonwebtoken');
const { User, Vault } = require('../models');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
    return jwt.sign(
        { userId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
};

// POST /api/auth/register - Register new user
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
        }

        // Check if user exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ error: '이미 등록된 이메일입니다.' });
        }

        // Create user
        const user = await User.create({
            email,
            passwordHash: password
        });

        // Generate token
        const token = generateToken(user.id);

        res.status(201).json({
            message: '회원가입이 완료되었습니다.',
            token,
            user: user.toJSON()
        });
    } catch (error) {
        console.error('Register error:', error);
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ error: error.errors[0].message });
        }
        res.status(500).json({
            error: '회원가입 중 오류가 발생했습니다.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// POST /api/auth/login - Login user
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요.' });
        }

        // Find user
        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
        }

        // Check password
        const isValid = await user.checkPassword(password);
        if (!isValid) {
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
        }

        // Generate token
        const token = generateToken(user.id);

        res.json({
            message: '로그인되었습니다.',
            token,
            user: user.toJSON()
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: '로그인 중 오류가 발생했습니다.' });
    }
});

// GET /api/auth/me - Get current user info
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const vault = await Vault.findOne({ where: { userId: req.user.id } });

        res.json({
            user: req.user.toJSON(),
            hasVault: !!vault,
            hasMasterPassword: vault ? !!vault.masterHash : false
        });
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({ error: '사용자 정보 조회 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
