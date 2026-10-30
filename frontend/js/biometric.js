/**
 * Biometric Authentication Module
 * WebAuthn API를 사용한 지문/Face ID 인증
 *
 * 키 보관 방식 (biometric_scheme)
 * - 'prf': WebAuthn PRF 확장으로 인증기에서 키를 유도. 키는 어디에도 저장하지 않음 (지문 없이는 복호화 불가)
 * - 'idb': PRF 미지원 기기. non-extractable AES 키를 IndexedDB에 보관
 *          (키 원본을 꺼내 갈 수는 없지만, 같은 origin 스크립트는 지문 없이 복호화 가능 — 지문은 UI 게이트)
 * - 구 형식: localStorage 'device_key'에 키 원본 저장 → 다음 잠금 해제 시 위 방식으로 전환
 */

const Biometric = {
    // 저장 키
    CREDENTIAL_KEY: 'biometric_enabled',
    MASTER_KEY: 'encrypted_master',
    LOGIN_CREDENTIALS_KEY: 'encrypted_login_credentials',
    SCHEME_KEY: 'biometric_scheme',
    LEGACY_KEY: 'device_key',
    USER_HANDLE_KEY: 'biometric_user_id',

    // PRF 입력값과 HKDF info (변경 시 기존 등록 기기의 키가 달라져 복호화 불가)
    PRF_SALT: new TextEncoder().encode('okfamily-biometric-prf-v1'),
    HKDF_INFO: new TextEncoder().encode('okfamily-biometric-v2'),

    // IndexedDB 키 저장소
    IDB_NAME: 'okfamily-biometric',
    IDB_STORE: 'keys',
    IDB_KEY_ID: 'device',

    // 잠금 해제 동안만 메모리에 두는 키 (non-extractable)
    _sessionKey: null,
    // 구 형식 전환 실패 시 이번 세션에서만 쓰는 자격증명
    _pendingCredentials: null,

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
     * 구 형식(키 원본이 localStorage에 있음) 여부
     */
    isLegacy() {
        return localStorage.getItem(this.LEGACY_KEY) !== null;
    },

    /**
     * 생체인증 등록 (마스터 비밀번호 + 로그인 자격증명 저장)
     */
    async register(masterPassword, email, password) {
        if (!await this.isSupported()) {
            throw new Error('이 기기에서 생체인증을 지원하지 않습니다.');
        }

        try {
            // 먼저 생체인증으로 본인 확인 (지문 등록) + PRF 출력 획득
            const { credentialId, prfOutput } = await this.createCredential(email);

            // PRF 지원 시 인증기에서 키 유도, 미지원 시 IndexedDB 키 생성
            const key = prfOutput
                ? await this.deriveKeyFromPrf(prfOutput)
                : await this.createStoredKey();

            // 암호문을 모두 먼저 계산 (저장 도중 실패해 반쪽 상태가 남지 않도록)
            const encryptedMaster = await this.encryptWithKey(key, masterPassword);
            const encryptedCredentials = email && password
                ? await this.encryptWithKey(key, JSON.stringify({ email, password }))
                : null;

            // 저장은 await 없이 한 번에 (중간에 탭이 닫혀도 구/신 데이터가 섞이지 않음)
            localStorage.setItem('credential_id', credentialId);
            localStorage.setItem(this.SCHEME_KEY, prfOutput ? 'prf' : 'idb');
            localStorage.setItem(this.MASTER_KEY, encryptedMaster);
            if (encryptedCredentials) {
                localStorage.setItem(this.LOGIN_CREDENTIALS_KEY, encryptedCredentials);
            } else {
                localStorage.removeItem(this.LOGIN_CREDENTIALS_KEY);
            }
            localStorage.removeItem(this.LEGACY_KEY);
            localStorage.setItem(this.CREDENTIAL_KEY, 'true');
            this._sessionKey = key;

            // PRF 방식이면 이전에 쓰던 IndexedDB 키 정리 (실패해도 등록은 유효)
            if (prfOutput) {
                this.deleteStoredKey().catch(error => console.error('생체인증 키 삭제 실패:', error));
            }
            return true;
        } catch (error) {
            console.error('생체인증 등록 실패:', error);
            if (error.name === 'NotAllowedError') {
                const cancelled = new Error('생체인증이 취소되었습니다.');
                cancelled.cancelled = true;
                throw cancelled;
            }
            throw new Error('생체인증 등록에 실패했습니다.');
        }
    },

    /**
     * WebAuthn user.id (재등록 시 같은 값을 써야 기기에 패스키가 쌓이지 않음)
     */
    getUserHandle() {
        const stored = localStorage.getItem(this.USER_HANDLE_KEY);
        if (stored) {
            return new Uint8Array(atob(stored).split('').map(c => c.charCodeAt(0)));
        }
        const userId = crypto.getRandomValues(new Uint8Array(16));
        localStorage.setItem(this.USER_HANDLE_KEY, btoa(String.fromCharCode(...userId)));
        return userId;
    },

    /**
     * 생체인증 Credential 생성 (지문 등록)
     * @returns {Promise<{credentialId: string, prfOutput: ArrayBuffer|null}>} PRF 출력은 미지원 시 null
     */
    async createCredential(email) {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = this.getUserHandle();

        const createOptions = {
            publicKey: {
                challenge: challenge,
                rp: {
                    name: '비밀번호 관리',
                    id: this.getRpId()
                },
                user: {
                    id: userId,
                    name: email || 'user@passwordmanager',
                    displayName: email || '사용자'
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },   // ES256
                    { type: 'public-key', alg: -257 }  // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform',  // 기기 내장 인증 (지문, Face ID)
                    userVerification: 'required',         // 생체인증 필수
                    residentKey: 'preferred'              // 패스키로 생성되어야 PRF 지원 범위가 넓음
                },
                extensions: {
                    prf: { eval: { first: this.PRF_SALT } }
                },
                timeout: 60000,
                attestation: 'none'
            }
        };

        // 지문/Face ID 등록 요청
        const credential = await navigator.credentials.create(createOptions);

        // Credential ID (저장은 register에서 다른 값과 함께 한 번에)
        const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));

        // 등록 시점에 PRF 결과를 주는 플랫폼도 있고, 인증(get) 때만 주는 플랫폼도 있음
        const prf = credential.getClientExtensionResults().prf;
        let prfOutput = null;
        if (prf && prf.results && prf.results.first) {
            prfOutput = prf.results.first;
        } else if (prf && prf.enabled) {
            prfOutput = await this.getAssertion(true, credentialId);
        }
        return { credentialId, prfOutput };
    },

    /**
     * 생체인증 요청 (지문/Face ID)
     * @param {boolean} withPrf - PRF 출력 요청 여부
     * @param {string} [credentialIdBase64] - 대상 credential ID (기본: 저장된 값)
     * @returns {Promise<ArrayBuffer|null>} PRF 출력 (요청하지 않았거나 없으면 null)
     */
    async getAssertion(withPrf, credentialIdBase64 = localStorage.getItem('credential_id')) {
        const allowCredentials = credentialIdBase64 ? [{
            type: 'public-key',
            id: new Uint8Array(atob(credentialIdBase64).split('').map(c => c.charCodeAt(0))),
            transports: ['internal']
        }] : [];

        const publicKey = {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            timeout: 60000,
            userVerification: 'required',
            rpId: this.getRpId(),
            allowCredentials: allowCredentials
        };
        if (withPrf) {
            publicKey.extensions = { prf: { eval: { first: this.PRF_SALT } } };
        }

        const credential = await navigator.credentials.get({ publicKey });
        if (!withPrf) return null;

        const prf = credential.getClientExtensionResults().prf;
        return (prf && prf.results && prf.results.first) || null;
    },

    /**
     * 생체인증으로 마스터 비밀번호 가져오기
     */
    async authenticate() {
        if (!this.isEnabled()) {
            throw new Error('생체인증이 설정되지 않았습니다.');
        }

        try {
            if (this.isLegacy()) {
                return await this.authenticateLegacy();
            }

            // 매번 지문 인증을 거쳐 키 확보
            const key = await this.unlockKey();
            this._sessionKey = key;

            const encryptedMaster = localStorage.getItem(this.MASTER_KEY);
            if (!encryptedMaster) {
                throw new Error('저장된 마스터 비밀번호가 없습니다.');
            }

            return await this.decryptWithKey(key, encryptedMaster);
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
     * 지문 인증 후 저장 방식에 맞는 키 확보
     */
    async unlockKey() {
        if (localStorage.getItem(this.SCHEME_KEY) === 'prf') {
            const prfOutput = await this.getAssertion(true);
            if (!prfOutput) {
                throw new Error('생체인증 키를 가져오지 못했습니다.');
            }
            return this.deriveKeyFromPrf(prfOutput);
        }

        await this.getAssertion(false);
        const key = await this.loadStoredKey();
        if (!key) {
            throw new Error('저장된 생체인증 키가 없습니다.');
        }
        return key;
    },

    /**
     * 현재 세션 키 (없으면 지문 인증으로 확보)
     */
    async getKey() {
        if (!this._sessionKey) {
            this._sessionKey = await this.unlockKey();
        }
        return this._sessionKey;
    },

    /**
     * 세션 키·임시 자격증명 메모리에서 제거
     */
    clearSession() {
        this._sessionKey = null;
        this._pendingCredentials = null;
    },

    /**
     * 구 형식 잠금 해제 → 새 방식으로 전환
     */
    async authenticateLegacy() {
        await this.getAssertion(false);

        const legacyKey = await this.loadLegacyKey();
        const encryptedMaster = localStorage.getItem(this.MASTER_KEY);
        if (!encryptedMaster) {
            throw new Error('저장된 마스터 비밀번호가 없습니다.');
        }
        const masterPassword = await this.decryptWithKey(legacyKey, encryptedMaster);

        await this.migrateLegacy(masterPassword, legacyKey);
        return masterPassword;
    },

    /**
     * 구 형식 데이터를 새 방식으로 재등록 (지문 1회 추가)
     * - 사용자가 취소: 구 데이터 유지, 다음 잠금 해제 때 재시도
     * - 그 외 실패: 구 데이터를 삭제하고 생체인증 해제 (마스터 비밀번호로는 항상 해제 가능)
     */
    async migrateLegacy(masterPassword, legacyKey) {
        const key = legacyKey || await this.loadLegacyKey();
        const encryptedCredentials = localStorage.getItem(this.LOGIN_CREDENTIALS_KEY);
        const credentials = encryptedCredentials
            ? JSON.parse(await this.decryptWithKey(key, encryptedCredentials))
            : null;

        try {
            await this.register(
                masterPassword,
                credentials ? credentials.email : null,
                credentials ? credentials.password : null
            );
        } catch (error) {
            console.error('생체인증 보안 업데이트 실패:', error);
            if (!error.cancelled) {
                this.disable();
            }
            this._pendingCredentials = credentials;
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
     * PRF 출력 → AES-256-GCM 키 (HKDF-SHA256, 추출 불가)
     */
    async deriveKeyFromPrf(prfOutput) {
        const keyMaterial = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: this.HKDF_INFO },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    },

    /**
     * 문자열 암호화 (IV 12바이트 + 암호문, Base64)
     */
    async encryptWithKey(key, text) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            new TextEncoder().encode(text)
        );

        // IV + 암호문 결합
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(encrypted), iv.length);

        return btoa(String.fromCharCode(...combined));
    },

    /**
     * 문자열 복호화
     */
    async decryptWithKey(key, encryptedData) {
        const combined = new Uint8Array(
            atob(encryptedData).split('').map(c => c.charCodeAt(0))
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: combined.slice(0, 12) },
            key,
            combined.slice(12)
        );

        return new TextDecoder().decode(decrypted);
    },

    /**
     * 구 형식 키 (localStorage 원본) 가져오기 — 전환용으로만 사용
     */
    async loadLegacyKey() {
        const keyBuffer = new Uint8Array(
            atob(localStorage.getItem(this.LEGACY_KEY)).split('').map(c => c.charCodeAt(0))
        );
        return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    },

    /**
     * IndexedDB 요청 실행 (트랜잭션 완료 후 결과 반환)
     */
    async runKeyStore(mode, operation) {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(this.IDB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(this.IDB_STORE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(this.IDB_STORE, mode);
                const request = operation(tx.objectStore(this.IDB_STORE));
                tx.oncomplete = () => resolve(request.result);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        } finally {
            db.close();
        }
    },

    /**
     * IndexedDB에 추출 불가 키 생성·저장 (PRF 미지원 기기용)
     */
    async createStoredKey() {
        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
        await this.runKeyStore('readwrite', store => store.put(key, this.IDB_KEY_ID));
        return key;
    },

    /**
     * IndexedDB 키 가져오기 (없으면 undefined)
     */
    loadStoredKey() {
        return this.runKeyStore('readonly', store => store.get(this.IDB_KEY_ID));
    },

    /**
     * IndexedDB 키 삭제
     */
    deleteStoredKey() {
        return this.runKeyStore('readwrite', store => store.delete(this.IDB_KEY_ID));
    },

    /**
     * 로그인 자격증명 복호화 반환
     */
    async getLoginCredentials() {
        if (this._pendingCredentials) {
            const credentials = this._pendingCredentials;
            this._pendingCredentials = null;
            return credentials;
        }

        const encrypted = localStorage.getItem(this.LOGIN_CREDENTIALS_KEY);
        if (!encrypted) return null;

        const key = this.isLegacy() ? await this.loadLegacyKey() : await this.getKey();
        return JSON.parse(await this.decryptWithKey(key, encrypted));
    },

    /**
     * 로그인 자격증명 존재 여부
     */
    hasLoginCredentials() {
        return !!localStorage.getItem(this.LOGIN_CREDENTIALS_KEY);
    },

    /**
     * 자동 로그인 가능 여부 (생체인증 ON + 자격증명 저장됨)
     */
    canAutoLogin() {
        return this.isEnabled() && this.hasLoginCredentials();
    },

    /**
     * 생체인증 비활성화 (암호문·키·저장 방식 모두 삭제)
     */
    disable() {
        localStorage.removeItem(this.CREDENTIAL_KEY);
        localStorage.removeItem(this.MASTER_KEY);
        localStorage.removeItem(this.LOGIN_CREDENTIALS_KEY);
        localStorage.removeItem('credential_id');
        localStorage.removeItem(this.LEGACY_KEY);
        localStorage.removeItem(this.SCHEME_KEY);
        this.clearSession();
        this.deleteStoredKey().catch(error => console.error('생체인증 키 삭제 실패:', error));
    },

    /**
     * 저장된 마스터 비밀번호 업데이트
     * 기존 로그인 자격증명은 유지하고, 마스터 비밀번호만 재암호화
     */
    async updateMaster(newPassword) {
        if (!this.isEnabled()) return;

        // 구 형식이면 이 기회에 새 방식으로 전환
        if (this.isLegacy()) {
            await this.migrateLegacy(newPassword);
            return;
        }

        // 마스터 비밀번호만 재암호화 (로그인 자격증명은 그대로 유지)
        const key = await this.getKey();
        localStorage.setItem(this.MASTER_KEY, await this.encryptWithKey(key, newPassword));
    }
};
