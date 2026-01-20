const express = require('express');
const { Vault } = require('../models');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/vault - Get encrypted vault data
router.get('/', async (req, res) => {
    try {
        const vault = await Vault.findOne({ where: { userId: req.user.id } });

        if (!vault) {
            return res.json({
                masterHash: null,
                encryptedData: null
            });
        }

        res.json({
            masterHash: vault.masterHash,
            encryptedData: vault.encryptedData
        });
    } catch (error) {
        console.error('Get vault error:', error);
        res.status(500).json({ error: 'Vault 조회 중 오류가 발생했습니다.' });
    }
});

// PUT /api/vault - Save encrypted vault data
router.put('/', async (req, res) => {
    try {
        const { masterHash, encryptedData } = req.body;

        if (!masterHash) {
            return res.status(400).json({ error: '마스터 해시가 필요합니다.' });
        }

        let vault = await Vault.findOne({ where: { userId: req.user.id } });

        if (vault) {
            // Update existing vault
            vault.encryptedData = encryptedData;
            await vault.save();
        } else {
            // Create new vault
            vault = await Vault.create({
                userId: req.user.id,
                masterHash,
                encryptedData
            });
        }

        res.json({
            message: '저장되었습니다.',
            updatedAt: vault.updated_at
        });
    } catch (error) {
        console.error('Save vault error:', error);
        res.status(500).json({ error: 'Vault 저장 중 오류가 발생했습니다.' });
    }
});

// PUT /api/vault/master - Update master password hash
router.put('/master', async (req, res) => {
    try {
        const { masterHash, encryptedData } = req.body;

        if (!masterHash) {
            return res.status(400).json({ error: '마스터 해시가 필요합니다.' });
        }

        let vault = await Vault.findOne({ where: { userId: req.user.id } });

        if (vault) {
            // Update master hash and re-encrypted data
            vault.masterHash = masterHash;
            if (encryptedData !== undefined) {
                vault.encryptedData = encryptedData;
            }
            await vault.save();
        } else {
            // Create new vault with master hash
            vault = await Vault.create({
                userId: req.user.id,
                masterHash,
                encryptedData: encryptedData || null
            });
        }

        res.json({
            message: '마스터 비밀번호가 변경되었습니다.',
            updatedAt: vault.updated_at
        });
    } catch (error) {
        console.error('Update master error:', error);
        res.status(500).json({ error: '마스터 비밀번호 변경 중 오류가 발생했습니다.' });
    }
});

// DELETE /api/vault - Delete vault (reset)
router.delete('/', async (req, res) => {
    try {
        await Vault.destroy({ where: { userId: req.user.id } });

        res.json({ message: 'Vault가 초기화되었습니다.' });
    } catch (error) {
        console.error('Delete vault error:', error);
        res.status(500).json({ error: 'Vault 삭제 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
