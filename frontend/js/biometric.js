/**
 * Biometric Authentication Module
 * WebAuthn API를 사용한 지문/Face ID 인증
 */

const Biometric = {
    // 저장 키
    CREDENTIAL_KEY: 'biometric_enabled',
    MASTER_KEY: 'encrypted_master',

    /**
     * 생체인증 지원 여부 확인
     */
    async isSupported() {
        // PublicKeyCredential API 지원 확인
        if (!window.PublicKeyCredential) {
            return false;
        }

        // 플랫폼 인증자 (지문, Face ID) 사용 가능 여부
        try {
            const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            return available;
        } catch {
            return false;
        }
    },

    /**
     * 생체인증 활성화 여부
     */
    isEnabled() {
        return localStorage.getItem(this.CREDENTIAL_KEY) === 'true';
    },

    /**
     * 생체인증 등록 (마스터 비밀번호 저장)
     */
    async register(masterPassword) {
        if (!await this.isSupported()) {
            throw new Error('이 기기에서 생체인증을 지원하지 않습니다.');
        }

        try {
            // 마스터 비밀번호를 암호화하여 저장
            const encryptedMaster = await this.encryptMaster(masterPassword);
            localStorage.setItem(this.MASTER_KEY, encryptedMaster);
            localStorage.setItem(this.CREDENTIAL_KEY, 'true');

            return true;
        } catch (error) {
            console.error('생체인증 등록 실패:', error);
            throw new Error('생체인증 등록에 실패했습니다.');
        }
    },

    /**
     * 생체인증으로 마스터 비밀번호 가져오기
     */
    async authenticate() {
        if (!this.isEnabled()) {
            throw new Error('생체인증이 설정되지 않았습니다.');
        }

        try {
            // 생체인증 요청
            const credential = await navigator.credentials.get({
                publicKey: {
                    challenge: crypto.getRandomValues(new Uint8Array(32)),
                    timeout: 60000,
                    userVerification: 'required',
                    rpId: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname
                }
            });

            // 인증 성공 시 저장된 마스터 비밀번호 복호화
            const encryptedMaster = localStorage.getItem(this.MASTER_KEY);
            if (!encryptedMaster) {
                throw new Error('저장된 마스터 비밀번호가 없습니다.');
            }

            return await this.decryptMaster(encryptedMaster);
        } catch (error) {
            // 사용자가 취소한 경우
            if (error.name === 'NotAllowedError') {
                throw new Error('생체인증이 취소되었습니다.');
            }
            // Credential이 없는 경우 - 간단한 생체인증 사용
            if (error.name === 'InvalidStateError' || !await this.hasCredential()) {
                return await this.authenticateSimple();
            }
            throw error;
        }
    },

    /**
     * 간단한 생체인증 (WebAuthn 없이)
     * - 일부 기기에서 WebAuthn이 완전히 지원되지 않을 때 사용
     */
    async authenticateSimple() {
        try {
            // CredentialLess 생체인증 시도
            const result = await this.requestBiometricAuth();

            if (result) {
                const encryptedMaster = localStorage.getItem(this.MASTER_KEY);
                if (!encryptedMaster) {
                    throw new Error('저장된 마스터 비밀번호가 없습니다.');
                }
                return await this.decryptMaster(encryptedMaster);
            }

            throw new Error('생체인증 실패');
        } catch (error) {
            if (error.name === 'NotAllowedError') {
                throw new Error('생체인증이 취소되었습니다.');
            }
            throw error;
        }
    },

    /**
     * 생체인증 요청 (PublicKeyCredential 생성 방식)
     */
    async requestBiometricAuth() {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = crypto.getRandomValues(new Uint8Array(16));

        try {
            // 먼저 기존 credential로 인증 시도
            const getOptions = {
                publicKey: {
                    challenge: challenge,
                    timeout: 60000,
                    userVerification: 'required',
                    rpId: this.getRpId()
                }
            };

            await navigator.credentials.get(getOptions);
            return true;
        } catch (getError) {
            // credential이 없으면 새로 생성하면서 인증
            try {
                const createOptions = {
                    publicKey: {
                        challenge: challenge,
                        rp: {
                            name: '비밀번호 관리',
                            id: this.getRpId()
                        },
                        user: {
                            id: userId,
                            name: 'user@passwordmanager',
                            displayName: '사용자'
                        },
                        pubKeyCredParams: [
                            { type: 'public-key', alg: -7 },  // ES256
                            { type: 'public-key', alg: -257 } // RS256
                        ],
                        authenticatorSelection: {
                            authenticatorAttachment: 'platform',
                            userVerification: 'required'
                        },
                        timeout: 60000
                    }
                };

                await navigator.credentials.create(createOptions);
                return true;
            } catch (createError) {
                if (createError.name === 'NotAllowedError') {
                    throw createError;
                }
                console.error('Credential 생성 실패:', createError);
                throw new Error('생체인증을 사용할 수 없습니다.');
            }
        }
    },

    /**
     * RP ID 가져오기
     */
    getRpId() {
        const hostname = window.location.hostname;
        // GitHub Pages의 경우
        if (hostname.endsWith('.github.io')) {
            return hostname;
        }
        // localhost
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'localhost';
        }
        return hostname;
    },

    /**
     * Credential 존재 여부 확인
     */
    async hasCredential() {
        try {
            const credentials = await navigator.credentials.get({
                publicKey: {
                    challenge: crypto.getRandomValues(new Uint8Array(32)),
                    timeout: 1000,
                    userVerification: 'discouraged',
                    rpId: this.getRpId()
                },
                mediation: 'silent'
            });
            return !!credentials;
        } catch {
            return false;
        }
    },

    /**
     * 마스터 비밀번호 암호화 (간단한 방식)
     * - 실제 보안을 위해 기기 바인딩 키 사용
     */
    async encryptMaster(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);

        // 기기 고유 키 생성 (또는 기존 키 사용)
        const key = await this.getDeviceKey();

        // IV 생성
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // AES-GCM 암호화
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );

        // IV + 암호문 결합
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(encrypted), iv.length);

        return btoa(String.fromCharCode(...combined));
    },

    /**
     * 마스터 비밀번호 복호화
     */
    async decryptMaster(encryptedData) {
        const combined = new Uint8Array(
            atob(encryptedData).split('').map(c => c.charCodeAt(0))
        );

        const iv = combined.slice(0, 12);
        const data = combined.slice(12);

        const key = await this.getDeviceKey();

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    },

    /**
     * 기기 고유 키 생성/가져오기
     */
    async getDeviceKey() {
        const keyData = localStorage.getItem('device_key');

        if (keyData) {
            // 기존 키 복원
            const keyBuffer = new Uint8Array(
                atob(keyData).split('').map(c => c.charCodeAt(0))
            );
            return await crypto.subtle.importKey(
                'raw',
                keyBuffer,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
            );
        }

        // 새 키 생성
        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );

        // 키 저장
        const exportedKey = await crypto.subtle.exportKey('raw', key);
        const keyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));
        localStorage.setItem('device_key', keyBase64);

        return key;
    },

    /**
     * 생체인증 비활성화
     */
    disable() {
        localStorage.removeItem(this.CREDENTIAL_KEY);
        localStorage.removeItem(this.MASTER_KEY);
    },

    /**
     * 저장된 마스터 비밀번호 업데이트
     */
    async updateMaster(newPassword) {
        if (this.isEnabled()) {
            await this.register(newPassword);
        }
    }
};
