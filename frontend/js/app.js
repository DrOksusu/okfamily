/**
 * 메인 앱 로직 - 서버 API 연동 버전
 */

const App = {
    // 상태
    masterPassword: null,
    passwords: [],
    currentEditId: null,
    autoLockTimeout: null,
    autoLockTime: 300000, // 5분
    vaultMasterHash: null, // 서버에서 가져온 마스터 해시

    // DOM 요소
    screens: {},
    elements: {},

    /**
     * 앱 초기화
     */
    async init() {
        try {
            // Service Worker 등록
            this.registerServiceWorker();

            // DOM 요소 캐싱
            this.cacheElements();

            // 이벤트 리스너 등록
            this.bindEvents();

            // 로컬 설정 불러오기
            const savedAutoLockTime = localStorage.getItem('autoLockTime');
            if (savedAutoLockTime) {
                this.autoLockTime = parseInt(savedAutoLockTime);
                this.elements.autoLockTime.value = savedAutoLockTime;
            }

            // 생체인증 지원 여부 확인 및 UI 업데이트
            await this.initBiometric();

            // 인증 상태 확인
            await this.checkAuth();
        } catch (error) {
            console.error('앱 초기화 오류:', error);
            this.showToast('앱 초기화 오류: ' + error.message);
        }
    },

    /**
     * 생체인증 초기화
     */
    async initBiometric() {
        const isSupported = await Biometric.isSupported();

        if (isSupported) {
            // 설정 화면에 생체인증 옵션 표시
            this.elements.biometricSettings.style.display = 'flex';

            // 토글 상태 설정
            this.elements.biometricToggle.checked = Biometric.isEnabled();
        }
    },

    /**
     * 인증 상태 확인
     */
    async checkAuth() {
        if (!API.isLoggedIn()) {
            this.showScreen('login');
            return;
        }

        try {
            this.showLoading(true);
            const { hasVault, hasMasterPassword } = await API.getMe();

            if (hasVault && hasMasterPassword) {
                // Vault 데이터 가져오기
                const vault = await API.getVault();
                this.vaultMasterHash = vault.masterHash;
                this.elements.lockMessage.textContent = '마스터 비밀번호를 입력하세요';
                this.elements.unlockBtn.textContent = '잠금 해제';

                // 생체인증 버튼 표시 여부
                if (Biometric.isEnabled()) {
                    this.elements.biometricBtn.style.display = 'flex';
                } else {
                    this.elements.biometricBtn.style.display = 'none';
                }
            } else {
                this.elements.lockMessage.textContent = '새 마스터 비밀번호를 설정하세요';
                this.elements.unlockBtn.textContent = '설정하기';
                this.elements.biometricBtn.style.display = 'none';
            }

            this.showScreen('lock');
        } catch (error) {
            console.error('인증 확인 오류:', error);
            // 토큰 만료 등의 경우 로그인 화면으로
            API.removeToken();
            this.showScreen('login');
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * Service Worker 등록
     */
    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .catch(err => console.log('SW 등록 실패:', err));
        }
    },

    /**
     * DOM 요소 캐싱
     */
    cacheElements() {
        this.screens = {
            login: document.getElementById('login-screen'),
            register: document.getElementById('register-screen'),
            lock: document.getElementById('lock-screen'),
            main: document.getElementById('main-screen'),
            edit: document.getElementById('edit-screen'),
            settings: document.getElementById('settings-screen')
        };

        this.elements = {
            // 로그인 화면
            loginForm: document.getElementById('login-form'),
            loginEmail: document.getElementById('login-email'),
            loginPassword: document.getElementById('login-password'),
            showRegisterBtn: document.getElementById('show-register-btn'),

            // 회원가입 화면
            registerForm: document.getElementById('register-form'),
            registerEmail: document.getElementById('register-email'),
            registerPassword: document.getElementById('register-password'),
            registerPasswordConfirm: document.getElementById('register-password-confirm'),
            showLoginBtn: document.getElementById('show-login-btn'),

            // 잠금 화면
            masterPassword: document.getElementById('master-password'),
            unlockBtn: document.getElementById('unlock-btn'),
            biometricBtn: document.getElementById('biometric-btn'),
            resetBtn: document.getElementById('reset-btn'),
            logoutBtn: document.getElementById('logout-btn'),
            lockMessage: document.getElementById('lock-message'),

            // 메인 화면
            lockBtn: document.getElementById('lock-btn'),
            settingsBtn: document.getElementById('settings-btn'),
            searchInput: document.getElementById('search-input'),
            passwordList: document.getElementById('password-list'),
            addBtn: document.getElementById('add-btn'),

            // 편집 화면
            backBtn: document.getElementById('back-btn'),
            editTitle: document.getElementById('edit-title'),
            deleteBtn: document.getElementById('delete-btn'),
            passwordForm: document.getElementById('password-form'),
            siteName: document.getElementById('site-name'),
            username: document.getElementById('username'),
            password: document.getElementById('password'),
            notes: document.getElementById('notes'),
            togglePassword: document.getElementById('toggle-password'),
            generatePassword: document.getElementById('generate-password'),

            // 설정 화면
            settingsBackBtn: document.getElementById('settings-back-btn'),
            autoLockTime: document.getElementById('auto-lock-time'),
            biometricSettings: document.getElementById('biometric-settings'),
            biometricToggle: document.getElementById('biometric-toggle'),
            exportBtn: document.getElementById('export-btn'),
            importBtn: document.getElementById('import-btn'),
            importFile: document.getElementById('import-file'),
            changeMasterBtn: document.getElementById('change-master-btn'),
            settingsLogoutBtn: document.getElementById('settings-logout-btn'),

            // 로딩 & 토스트
            loadingOverlay: document.getElementById('loading-overlay'),
            toast: document.getElementById('toast')
        };
    },

    /**
     * 이벤트 리스너 등록
     */
    bindEvents() {
        // 로그인 화면
        this.elements.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        this.elements.showRegisterBtn.addEventListener('click', () => this.showScreen('register'));

        // 회원가입 화면
        this.elements.registerForm.addEventListener('submit', (e) => this.handleRegister(e));
        this.elements.showLoginBtn.addEventListener('click', () => this.showScreen('login'));

        // 잠금 화면
        this.elements.unlockBtn.addEventListener('click', () => this.handleUnlock());
        this.elements.masterPassword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleUnlock();
        });
        this.elements.biometricBtn.addEventListener('click', () => this.handleBiometricUnlock());
        this.elements.resetBtn.addEventListener('click', () => this.handleReset());
        this.elements.logoutBtn.addEventListener('click', () => this.handleLogout());

        // 메인 화면
        this.elements.lockBtn.addEventListener('click', () => this.lock());
        this.elements.settingsBtn.addEventListener('click', () => this.showScreen('settings'));
        this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        this.elements.addBtn.addEventListener('click', () => this.showEditScreen());

        // 편집 화면
        this.elements.backBtn.addEventListener('click', () => this.showScreen('main'));
        this.elements.passwordForm.addEventListener('submit', (e) => this.handleSave(e));
        this.elements.deleteBtn.addEventListener('click', () => this.handleDelete());
        this.elements.togglePassword.addEventListener('click', () => this.togglePasswordVisibility());
        this.elements.generatePassword.addEventListener('click', () => this.handleGeneratePassword());

        // 설정 화면
        this.elements.settingsBackBtn.addEventListener('click', () => this.showScreen('main'));
        this.elements.autoLockTime.addEventListener('change', (e) => this.handleAutoLockTimeChange(e));
        this.elements.biometricToggle.addEventListener('change', (e) => this.handleBiometricToggle(e));
        this.elements.exportBtn.addEventListener('click', () => this.handleExport());
        this.elements.importBtn.addEventListener('click', () => this.elements.importFile.click());
        this.elements.importFile.addEventListener('change', (e) => this.handleImport(e));
        this.elements.changeMasterBtn.addEventListener('click', () => this.handleChangeMaster());
        this.elements.settingsLogoutBtn.addEventListener('click', () => this.handleLogout());

        // 자동 잠금을 위한 활동 감지
        ['click', 'keypress', 'scroll', 'touchstart'].forEach(event => {
            document.addEventListener(event, () => this.resetAutoLock());
        });

        // 인증 만료 이벤트 수신
        window.addEventListener('auth:logout', () => {
            this.showToast('세션이 만료되었습니다. 다시 로그인하세요.');
            this.handleLogout();
        });
    },

    /**
     * 로그인 처리
     */
    async handleLogin(e) {
        e.preventDefault();

        const email = this.elements.loginEmail.value.trim();
        const password = this.elements.loginPassword.value;

        if (!email || !password) {
            this.showToast('이메일과 비밀번호를 입력하세요');
            return;
        }

        try {
            this.showLoading(true);
            await API.login(email, password);
            this.elements.loginForm.reset();
            await this.checkAuth();
        } catch (error) {
            this.showToast(error.message);
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 회원가입 처리
     */
    async handleRegister(e) {
        e.preventDefault();

        const email = this.elements.registerEmail.value.trim();
        const password = this.elements.registerPassword.value;
        const passwordConfirm = this.elements.registerPasswordConfirm.value;

        if (!email || !password) {
            this.showToast('이메일과 비밀번호를 입력하세요');
            return;
        }

        if (password.length < 6) {
            this.showToast('비밀번호는 6자 이상이어야 합니다');
            return;
        }

        if (password !== passwordConfirm) {
            this.showToast('비밀번호가 일치하지 않습니다');
            return;
        }

        try {
            this.showLoading(true);
            await API.register(email, password);
            this.elements.registerForm.reset();
            this.showToast('회원가입이 완료되었습니다');
            await this.checkAuth();
        } catch (error) {
            this.showToast(error.message);
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 로그아웃 처리
     */
    handleLogout() {
        this.masterPassword = null;
        this.passwords = [];
        this.vaultMasterHash = null;
        this.clearAutoLock();
        API.logout();
        this.showScreen('login');
    },

    /**
     * 잠금 해제 / 초기 설정
     */
    async handleUnlock() {
        try {
            const password = this.elements.masterPassword.value;
            if (!password) {
                this.showToast('비밀번호를 입력하세요');
                return;
            }

            this.showLoading(true);

            if (this.vaultMasterHash) {
                // 기존 비밀번호 검증
                const isValid = await Crypto.verifyPassword(password, this.vaultMasterHash);

                if (!isValid) {
                    this.showToast('비밀번호가 올바르지 않습니다');
                    this.elements.masterPassword.value = '';
                    this.showLoading(false);
                    return;
                }

                this.masterPassword = password;
                await this.loadPasswords();
            } else {
                // 새 비밀번호 설정
                if (password.length < 4) {
                    this.showToast('비밀번호는 4자 이상이어야 합니다');
                    this.showLoading(false);
                    return;
                }

                const hash = await Crypto.hashPassword(password);
                this.vaultMasterHash = hash;
                this.masterPassword = password;
                this.passwords = [];
                await this.savePasswords();
            }

            this.elements.masterPassword.value = '';
            this.showScreen('main');
            this.renderPasswordList();
            this.resetAutoLock();
        } catch (error) {
            console.error('잠금 해제 오류:', error);
            this.showToast('오류: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 생체인증으로 잠금 해제
     */
    async handleBiometricUnlock() {
        try {
            this.showLoading(true);

            // 생체인증으로 마스터 비밀번호 가져오기
            const password = await Biometric.authenticate();

            // 비밀번호 검증
            const isValid = await Crypto.verifyPassword(password, this.vaultMasterHash);

            if (!isValid) {
                this.showToast('생체인증 데이터가 유효하지 않습니다. 비밀번호로 로그인하세요.');
                Biometric.disable();
                this.elements.biometricBtn.style.display = 'none';
                return;
            }

            this.masterPassword = password;
            await this.loadPasswords();

            this.showScreen('main');
            this.renderPasswordList();
            this.resetAutoLock();
        } catch (error) {
            console.error('생체인증 오류:', error);
            this.showToast(error.message || '생체인증 실패');
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 생체인증 설정 토글
     */
    async handleBiometricToggle(e) {
        const enabled = e.target.checked;

        if (enabled) {
            // 생체인증 활성화 - 마스터 비밀번호 필요
            if (!this.masterPassword) {
                this.showToast('먼저 마스터 비밀번호로 잠금을 해제하세요');
                e.target.checked = false;
                return;
            }

            try {
                await Biometric.register(this.masterPassword);
                this.showToast('지문 인증이 활성화되었습니다');
            } catch (error) {
                this.showToast(error.message);
                e.target.checked = false;
            }
        } else {
            // 생체인증 비활성화
            Biometric.disable();
            this.showToast('지문 인증이 비활성화되었습니다');
        }
    },

    /**
     * 잠금
     */
    lock() {
        this.masterPassword = null;
        this.passwords = [];
        this.clearAutoLock();
        this.showScreen('lock');
        this.elements.unlockBtn.textContent = '잠금 해제';
        this.elements.lockMessage.textContent = '마스터 비밀번호를 입력하세요';

        // 생체인증 버튼 표시 여부
        if (Biometric.isEnabled()) {
            this.elements.biometricBtn.style.display = 'flex';
        }
    },

    /**
     * 비밀번호 목록 불러오기
     */
    async loadPasswords() {
        const vault = await API.getVault();
        if (vault.encryptedData) {
            this.passwords = await Crypto.decrypt(vault.encryptedData, this.masterPassword);
        } else {
            this.passwords = [];
        }
    },

    /**
     * 비밀번호 목록 저장
     */
    async savePasswords() {
        const encryptedData = await Crypto.encrypt(this.passwords, this.masterPassword);
        await API.saveVault(this.vaultMasterHash, encryptedData);
    },

    /**
     * 비밀번호 목록 렌더링
     */
    renderPasswordList(filter = '') {
        const filtered = filter
            ? this.passwords.filter(p =>
                p.siteName.toLowerCase().includes(filter.toLowerCase()) ||
                (p.username && p.username.toLowerCase().includes(filter.toLowerCase()))
            )
            : this.passwords;

        if (filtered.length === 0) {
            this.elements.passwordList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔑</div>
                    <p>${filter ? '검색 결과가 없습니다' : '저장된 비밀번호가 없습니다'}</p>
                </div>
            `;
            return;
        }

        this.elements.passwordList.innerHTML = filtered.map(p => `
            <li class="password-item" data-id="${p.id}">
                <div class="password-item-icon">${p.siteName.charAt(0).toUpperCase()}</div>
                <div class="password-item-info">
                    <div class="password-item-name">${this.escapeHtml(p.siteName)}</div>
                    <div class="password-item-username">${this.escapeHtml(p.username || '(아이디 없음)')}</div>
                </div>
            </li>
        `).join('');

        // 클릭 이벤트 추가
        this.elements.passwordList.querySelectorAll('.password-item').forEach(item => {
            item.addEventListener('click', () => this.showEditScreen(item.dataset.id));
        });
    },

    /**
     * 검색 처리
     */
    handleSearch(query) {
        this.renderPasswordList(query);
    },

    /**
     * 편집 화면 표시
     */
    showEditScreen(id = null) {
        this.currentEditId = id;

        if (id) {
            // 편집 모드
            const password = this.passwords.find(p => p.id === id);
            if (!password) return;

            this.elements.editTitle.textContent = '비밀번호 편집';
            this.elements.deleteBtn.style.display = 'block';
            this.elements.siteName.value = password.siteName;
            this.elements.username.value = password.username || '';
            this.elements.password.value = password.password;
            this.elements.notes.value = password.notes || '';
        } else {
            // 추가 모드
            this.elements.editTitle.textContent = '새 비밀번호';
            this.elements.deleteBtn.style.display = 'none';
            this.elements.passwordForm.reset();
        }

        this.elements.password.type = 'password';
        this.showScreen('edit');
    },

    /**
     * 저장 처리
     */
    async handleSave(e) {
        e.preventDefault();

        const data = {
            id: this.currentEditId || Date.now().toString(),
            siteName: this.elements.siteName.value.trim(),
            username: this.elements.username.value.trim(),
            password: this.elements.password.value,
            notes: this.elements.notes.value.trim(),
            updatedAt: Date.now()
        };

        try {
            this.showLoading(true);

            if (this.currentEditId) {
                // 편집
                const index = this.passwords.findIndex(p => p.id === this.currentEditId);
                if (index !== -1) {
                    this.passwords[index] = data;
                }
            } else {
                // 추가
                this.passwords.push(data);
            }

            await this.savePasswords();
            this.showToast('저장되었습니다');
            this.showScreen('main');
            this.renderPasswordList();
        } catch (error) {
            this.showToast('저장 실패: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 삭제 처리
     */
    async handleDelete() {
        if (!confirm('정말 삭제하시겠습니까?')) return;

        try {
            this.showLoading(true);
            this.passwords = this.passwords.filter(p => p.id !== this.currentEditId);
            await this.savePasswords();
            this.showToast('삭제되었습니다');
            this.showScreen('main');
            this.renderPasswordList();
        } catch (error) {
            this.showToast('삭제 실패: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 비밀번호 표시/숨기기 토글
     */
    togglePasswordVisibility() {
        const input = this.elements.password;
        input.type = input.type === 'password' ? 'text' : 'password';
    },

    /**
     * 비밀번호 자동 생성
     */
    handleGeneratePassword() {
        const generated = Crypto.generatePassword(16);
        this.elements.password.value = generated;
        this.elements.password.type = 'text';
        this.showToast('비밀번호가 생성되었습니다');
    },

    /**
     * 자동 잠금 시간 변경
     */
    handleAutoLockTimeChange(e) {
        this.autoLockTime = parseInt(e.target.value);
        localStorage.setItem('autoLockTime', this.autoLockTime);
        this.resetAutoLock();
    },

    /**
     * 백업 내보내기
     */
    async handleExport() {
        try {
            const vault = await API.getVault();
            const exportData = {
                version: 1,
                exportedAt: new Date().toISOString(),
                masterHash: vault.masterHash,
                data: vault.encryptedData
            };

            const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `password-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);

            this.showToast('백업 파일이 다운로드됩니다');
        } catch (error) {
            this.showToast('백업 실패: ' + error.message);
        }
    },

    /**
     * 백업 가져오기
     */
    async handleImport(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            this.showLoading(true);
            const text = await file.text();
            const importData = JSON.parse(text);

            if (!importData.data || !importData.masterHash) {
                throw new Error('올바른 백업 파일이 아닙니다');
            }

            // 복호화 테스트 (현재 마스터 비밀번호로)
            await Crypto.decrypt(importData.data, this.masterPassword);

            // 서버에 저장
            await API.saveVault(importData.masterHash, importData.data);
            this.vaultMasterHash = importData.masterHash;

            await this.loadPasswords();
            this.renderPasswordList();

            this.showToast('백업이 복원되었습니다');
        } catch (error) {
            this.showToast('가져오기 실패: ' + error.message);
        } finally {
            this.showLoading(false);
            e.target.value = '';
        }
    },

    /**
     * 마스터 비밀번호 변경
     */
    async handleChangeMaster() {
        const newPassword = prompt('새 마스터 비밀번호를 입력하세요:');
        if (!newPassword) return;

        if (newPassword.length < 4) {
            this.showToast('비밀번호는 4자 이상이어야 합니다');
            return;
        }

        const confirmPassword = prompt('새 비밀번호를 다시 입력하세요:');
        if (newPassword !== confirmPassword) {
            this.showToast('비밀번호가 일치하지 않습니다');
            return;
        }

        try {
            this.showLoading(true);

            // 새 비밀번호로 해시 및 데이터 재암호화
            const hash = await Crypto.hashPassword(newPassword);
            const encryptedData = await Crypto.encrypt(this.passwords, newPassword);

            await API.updateMaster(hash, encryptedData);

            this.vaultMasterHash = hash;
            this.masterPassword = newPassword;

            // 생체인증이 활성화된 경우 업데이트
            if (Biometric.isEnabled()) {
                await Biometric.updateMaster(newPassword);
            }

            this.showToast('마스터 비밀번호가 변경되었습니다');
        } catch (error) {
            this.showToast('변경 실패: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 데이터 초기화
     */
    async handleReset() {
        if (!confirm('모든 데이터가 삭제됩니다. 계속하시겠습니까?')) return;

        try {
            this.showLoading(true);
            await API.deleteVault();

            this.masterPassword = null;
            this.passwords = [];
            this.vaultMasterHash = null;

            this.elements.lockMessage.textContent = '새 마스터 비밀번호를 설정하세요';
            this.elements.unlockBtn.textContent = '설정하기';
            this.showToast('초기화되었습니다');
        } catch (error) {
            this.showToast('초기화 실패: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 화면 전환
     */
    showScreen(name) {
        Object.values(this.screens).forEach(screen => {
            screen.classList.remove('active');
            screen.style.display = 'none';
        });
        this.screens[name].classList.add('active');

        // 화면별 display 스타일
        if (['login', 'register', 'lock'].includes(name)) {
            this.screens[name].style.display = 'flex';
        } else {
            this.screens[name].style.display = 'block';
        }
    },

    /**
     * 로딩 표시
     */
    showLoading(show) {
        if (show) {
            this.elements.loadingOverlay.classList.add('show');
        } else {
            this.elements.loadingOverlay.classList.remove('show');
        }
    },

    /**
     * 토스트 메시지 표시
     */
    showToast(message) {
        this.elements.toast.textContent = message;
        this.elements.toast.classList.add('show');
        setTimeout(() => this.elements.toast.classList.remove('show'), 2500);
    },

    /**
     * 자동 잠금 타이머 리셋
     */
    resetAutoLock() {
        if (!this.masterPassword) return;
        this.clearAutoLock();
        this.autoLockTimeout = setTimeout(() => this.lock(), this.autoLockTime);
    },

    /**
     * 자동 잠금 타이머 해제
     */
    clearAutoLock() {
        if (this.autoLockTimeout) {
            clearTimeout(this.autoLockTimeout);
            this.autoLockTimeout = null;
        }
    },

    /**
     * HTML 이스케이프
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// 앱 시작
document.addEventListener('DOMContentLoaded', () => App.init());
