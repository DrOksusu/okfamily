/**
 * 암호화 모듈 - Web Crypto API 사용
 * AES-256-GCM 암호화 + PBKDF2 키 유도
 */

const Crypto = {
    // PBKDF2 설정
    ITERATIONS: 100000,
    KEY_LENGTH: 256,

    /**
     * 마스터 비밀번호로부터 암호화 키 유도
     */
    async deriveKey(password, salt) {
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);

        // 비밀번호를 키 재료로 변환
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveKey']
        );

        // PBKDF2로 AES 키 유도
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: this.ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: this.KEY_LENGTH },
            false,
            ['encrypt', 'decrypt']
        );
    },

    /**
     * 데이터 암호화
     */
    async encrypt(data, password) {
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(JSON.stringify(data));

        // 랜덤 salt와 iv 생성
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // 키 유도
        const key = await this.deriveKey(password, salt);

        // AES-GCM 암호화
        const encryptedBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            dataBuffer
        );

        // salt + iv + 암호문을 합쳐서 Base64로 반환
        const combined = new Uint8Array(salt.length + iv.length + encryptedBuffer.byteLength);
        combined.set(salt, 0);
        combined.set(iv, salt.length);
        combined.set(new Uint8Array(encryptedBuffer), salt.length + iv.length);

        return btoa(String.fromCharCode(...combined));
    },

    /**
     * 데이터 복호화
     */
    async decrypt(encryptedData, password) {
        try {
            // Base64 디코딩
            const combined = new Uint8Array(
                atob(encryptedData).split('').map(c => c.charCodeAt(0))
            );

            // salt, iv, 암호문 분리
            const salt = combined.slice(0, 16);
            const iv = combined.slice(16, 28);
            const encryptedBuffer = combined.slice(28);

            // 키 유도
            const key = await this.deriveKey(password, salt);

            // AES-GCM 복호화
            const decryptedBuffer = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                encryptedBuffer
            );

            const decoder = new TextDecoder();
            return JSON.parse(decoder.decode(decryptedBuffer));
        } catch (error) {
            throw new Error('복호화 실패: 비밀번호가 올바르지 않습니다.');
        }
    },

    /**
     * 마스터 비밀번호 검증용 해시 생성
     */
    async hashPassword(password) {
        const encoder = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const passwordBuffer = encoder.encode(password);

        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveBits']
        );

        const hashBuffer = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: this.ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            256
        );

        const hashArray = new Uint8Array(hashBuffer);
        const combined = new Uint8Array(salt.length + hashArray.length);
        combined.set(salt, 0);
        combined.set(hashArray, salt.length);

        return btoa(String.fromCharCode(...combined));
    },

    /**
     * 마스터 비밀번호 검증
     */
    async verifyPassword(password, storedHash) {
        try {
            const combined = new Uint8Array(
                atob(storedHash).split('').map(c => c.charCodeAt(0))
            );

            const salt = combined.slice(0, 16);
            const storedHashArray = combined.slice(16);

            const encoder = new TextEncoder();
            const passwordBuffer = encoder.encode(password);

            const keyMaterial = await crypto.subtle.importKey(
                'raw',
                passwordBuffer,
                'PBKDF2',
                false,
                ['deriveBits']
            );

            const hashBuffer = await crypto.subtle.deriveBits(
                {
                    name: 'PBKDF2',
                    salt: salt,
                    iterations: this.ITERATIONS,
                    hash: 'SHA-256'
                },
                keyMaterial,
                256
            );

            const newHashArray = new Uint8Array(hashBuffer);

            // 타이밍 공격 방지를 위한 상수 시간 비교
            if (newHashArray.length !== storedHashArray.length) return false;
            let result = 0;
            for (let i = 0; i < newHashArray.length; i++) {
                result |= newHashArray[i] ^ storedHashArray[i];
            }
            return result === 0;
        } catch {
            return false;
        }
    },

    /**
     * 랜덤 비밀번호 생성
     */
    generatePassword(length = 16, options = {}) {
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

        let chars = lowercase + uppercase + numbers;
        if (options.includeSymbols !== false) {
            chars += symbols;
        }

        const array = new Uint32Array(length);
        crypto.getRandomValues(array);

        return Array.from(array, (x) => chars[x % chars.length]).join('');
    }
};
