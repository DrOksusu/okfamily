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
            // 먼저 생체인증으로 본인 확인 (지문 등록)
            await this.createCredential();

            // 인증 성공 후 마스터 비밀번호를 암호화하여 저장
            const encryptedMaster = await this.encryptMaster(masterPassword);
            localStorage.setItem(this.MASTER_KEY, encryptedMaster);
            localStorage.setItem(this.CREDENTIAL_KEY, 'true');

            return true;
        } catch (error) {
            console.error('생체인증 등록 실패:', error);
            if (error.name === 'NotAllowedError') {
                throw new Error('생체인증이 취소되었습니다.');
            }
            throw new Error('생체인증 등록에 실패했습니다.');
        }
    },

    /**
     * 생체인증 Credential 생성 (지문 등록)
     */
    async createCredential() {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = crypto.getRandomValues(new Uint8Array(16));

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
                    { type: 'public-key', alg: -7 },   // ES256
                    { type: 'public-key', alg: -257 }  // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',  // 기기 내장 인증 (지문, Face ID)
                    userVerification: 'required',         // 생체인증 필수
                    residentKey: 'discouraged'
                },
                timeout: 60000,
                attestation: 'none'
            }
        };

        // 지문/Face ID 등록 요청
        const credential = await navigator.credentials.create(createOptions);

        // Credential ID 저장 (나중에 인증 시 사용)
        const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
        localStorage.setItem('credential_id', credentialId);

        return credential;
    },

    /**
     * 생체인증으로 마스터 비밀번호 가져오기
     */
    async authenticate() {
        if (!this.isEnabled()) {
            throw new Error('생체인증이 설정되지 않았습니다.');
        }

        try {
            // 저장된 credential ID 가져오기
            const credentialIdBase64 = localStorage.getItem('credential_id');
            const allowCredentials = credentialIdBase64 ? [{
                type: 'public-key',
                id: new Uint8Array(atob(credentialIdBase64).split('').map(c => c.charCodeAt(0))),
                transports: ['internal']
            }] : [];

            // 생체인증 요청 (지문/Face ID)
            const credential = await navigator.credentials.get({
                publicKey: {
                    challenge: crypto.getRandomValues(new Uint8Array(32)),
                    timeout: 60000,
                    userVerification: 'required',
                    rpId: this.getRpId(),
                    allowCredentials: allowCredentials
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
            console.error('생체인증 오류:', error);
            throw new Error('생체인증에 실패했습니다. 비밀번호로 로그인하세요.');
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
        localStorage.removeItem('credential_id');
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
