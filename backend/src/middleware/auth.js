const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authMiddleware = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '인증이 필요합니다.' });
        }

        const token = authHeader.split(' ')[1];

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Find user
        const user = await User.findByPk(decoded.userId);
        if (!user) {
            return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });
        }

        // Attach user to request
        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: '토큰이 만료되었습니다. 다시 로그인하세요.' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
        }
        console.error('Auth middleware error:', error);
        return res.status(500).json({ error: '인증 처리 중 오류가 발생했습니다.' });
    }
};

module.exports = authMiddleware;
