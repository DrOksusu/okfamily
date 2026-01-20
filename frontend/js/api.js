/**
 * API 모듈 - 서버와 통신
 */

const API = {
    // 백엔드 서버 URL (환경에 따라 변경)
    BASE_URL: 'http://localhost:3000/api',

    // JWT 토큰 저장 키
    TOKEN_KEY: 'auth_token',

    /**
     * 토큰 저장
     */
    saveToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token);
    },

    /**
     * 토큰 가져오기
     */
    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    },

    /**
     * 토큰 삭제
     */
    removeToken() {
        localStorage.removeItem(this.TOKEN_KEY);
    },

    /**
     * 로그인 상태 확인
     */
    isLoggedIn() {
        return !!this.getToken();
    },

    /**
     * API 요청 헬퍼
     */
    async request(endpoint, options = {}) {
        const url = `${this.BASE_URL}${endpoint}`;
        const token = this.getToken();

        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            const data = await response.json();

            if (!response.ok) {
                // 토큰 만료 시 로그아웃 처리
                if (response.status === 401) {
                    this.removeToken();
                    window.dispatchEvent(new CustomEvent('auth:logout'));
                }
                throw new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
            }

            return data;
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('서버에 연결할 수 없습니다. 네트워크를 확인하세요.');
            }
            throw error;
        }
    },

    // ========== 인증 API ==========

    /**
     * 회원가입
     */
    async register(email, password) {
        const data = await this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        this.saveToken(data.token);
        return data;
    },

    /**
     * 로그인
     */
    async login(email, password) {
        const data = await this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        this.saveToken(data.token);
        return data;
    },

    /**
     * 로그아웃
     */
    logout() {
        this.removeToken();
    },

    /**
     * 현재 사용자 정보 조회
     */
    async getMe() {
        return this.request('/auth/me');
    },

    // ========== Vault API ==========

    /**
     * Vault 데이터 조회
     */
    async getVault() {
        return this.request('/vault');
    },

    /**
     * Vault 데이터 저장
     */
    async saveVault(masterHash, encryptedData) {
        return this.request('/vault', {
            method: 'PUT',
            body: JSON.stringify({ masterHash, encryptedData })
        });
    },

    /**
     * 마스터 비밀번호 변경
     */
    async updateMaster(masterHash, encryptedData) {
        return this.request('/vault/master', {
            method: 'PUT',
            body: JSON.stringify({ masterHash, encryptedData })
        });
    },

    /**
     * Vault 초기화
     */
    async deleteVault() {
        return this.request('/vault', {
            method: 'DELETE'
        });
    }
};
