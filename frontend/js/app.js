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
    selectedCategoryFilter: 'all', // 카테고리 필터 상태
    DEFAULT_CATEGORIES: ['은행', '증권', '암호화폐', '생활'],
    loginEmail: null, // 현재 세션의 로그인 이메일 (메모리에만 보관)
    loginPassword: null, // 현재 세션의 로그인 비밀번호 (메모리에만 보관)
    _checkingAuth: false, // checkAuth 진행 중 플래그

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
        this._checkingAuth = true;

        // 토큰 없음: 자동 로그인 가능하면 lock-screen → 지문, 아니면 로그인 화면
        if (!API.isLoggedIn()) {
            if (Biometric.canAutoLogin()) {
                this.showLockScreenForAutoLogin();
                setTimeout(() => this.handleBiometricAutoLogin(), 300);
            } else {
                this.showScreen('login');
            }
            this._checkingAuth = false;
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

            // 생체인증 활성화 시 자동으로 지문 인증 시도
            if (Biometric.isEnabled()) {
                setTimeout(() => this.handleBiometricUnlock(), 300);
            }
        } catch (error) {
            console.error('인증 확인 오류:', error);
            // 토큰 만료 등: 자동 로그인 가능하면 지문 시도
            API.removeToken();
            if (Biometric.canAutoLogin()) {
                this.showLockScreenForAutoLogin();
                setTimeout(() => this.handleBiometricAutoLogin(), 300);
            } else {
                this.showScreen('login');
            }
        } finally {
            this.showLoading(false);
            this._checkingAuth = false;
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
            detail: document.getElementById('detail-screen'),
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

            // 상세 보기 화면
            detailBackBtn: document.getElementById('detail-back-btn'),
            detailTitle: document.getElementById('detail-title'),
            editBtn: document.getElementById('edit-btn'),
            detailIcon: document.getElementById('detail-icon'),
            detailSiteName: document.getElementById('detail-site-name'),
            detailUsername: document.getElementById('detail-username'),
            detailPassword: document.getElementById('detail-password'),
            detailNotes: document.getElementById('detail-notes'),
            detailNotesContainer: document.getElementById('detail-notes-container'),
            copyUsernameBtn: document.getElementById('copy-username-btn'),
            copyPasswordBtn: document.getElementById('copy-password-btn'),
            toggleDetailPassword: document.getElementById('toggle-detail-password'),
            detailDeleteBtn: document.getElementById('detail-delete-btn'),

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

            // 카테고리 관련
            categoryFilter: document.getElementById('category-filter'),
            categorySelect: document.getElementById('category-select'),
            customCategoryInput: document.getElementById('custom-category-input'),
            detailCategory: document.getElementById('detail-category'),

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

            // 붙여넣기 모달
            pasteBtn: document.getElementById('paste-btn'),
            pasteModal: document.getElementById('paste-modal'),
            pasteModalClose: document.getElementById('paste-modal-close'),
            pasteInput: document.getElementById('paste-input'),
            pasteAnalyzeBtn: document.getElementById('paste-analyze-btn'),

            // 생체인증 제안 모달
            biometricSuggestModal: document.getElementById('biometric-suggest-modal'),
            biometricSuggestClose: document.getElementById('biometric-suggest-close'),
            biometricSuggestYes: document.getElementById('biometric-suggest-yes'),
            biometricSuggestNo: document.getElementById('biometric-suggest-no'),

            // 자격증명 입력 모달
            credentialModal: document.getElementById('credential-modal'),
            credentialModalClose: document.getElementById('credential-modal-close'),
            credentialEmail: document.getElementById('credential-email'),
            credentialPassword: document.getElementById('credential-password'),
            credentialConfirmBtn: document.getElementById('credential-confirm-btn'),

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

        // 붙여넣기 모달
        this.elements.pasteBtn.addEventListener('click', () => this.showPasteModal());
        this.elements.pasteModalClose.addEventListener('click', () => this.hidePasteModal());
        this.elements.pasteModal.addEventListener('click', (e) => {
            if (e.target === this.elements.pasteModal) this.hidePasteModal();
        });
        this.elements.pasteAnalyzeBtn.addEventListener('click', () => this.handlePasteAnalyze());

        // 생체인증 제안 모달
        this.elements.biometricSuggestClose.addEventListener('click', () => this.dismissBiometricSuggest());
        this.elements.biometricSuggestNo.addEventListener('click', () => this.dismissBiometricSuggest());
        this.elements.biometricSuggestYes.addEventListener('click', () => this.acceptBiometricSuggest());
        this.elements.biometricSuggestModal.addEventListener('click', (e) => {
            if (e.target === this.elements.biometricSuggestModal) this.dismissBiometricSuggest();
        });

        // 자격증명 입력 모달
        this.elements.credentialModalClose.addEventListener('click', () => this.hideCredentialModal());
        this.elements.credentialModal.addEventListener('click', (e) => {
            if (e.target === this.elements.credentialModal) this.hideCredentialModal();
        });

        // 상세 보기 화면
        this.elements.detailBackBtn.addEventListener('click', () => this.showScreen('main'));
        this.elements.editBtn.addEventListener('click', () => this.showEditScreen(this.currentEditId));
        this.elements.copyUsernameBtn.addEventListener('click', () => this.copyToClipboard('username'));
        this.elements.copyPasswordBtn.addEventListener('click', () => this.copyToClipboard('password'));
        this.elements.toggleDetailPassword.addEventListener('click', () => this.toggleDetailPasswordVisibility());
        this.elements.detailDeleteBtn.addEventListener('click', () => this.handleDelete());

        // 편집 화면
        this.elements.backBtn.addEventListener('click', () => this.showScreen('main'));
        this.elements.passwordForm.addEventListener('submit', (e) => this.handleSave(e));
        this.elements.deleteBtn.addEventListener('click', () => this.handleDelete());
        this.elements.togglePassword.addEventListener('click', () => this.togglePasswordVisibility());
        this.elements.generatePassword.addEventListener('click', () => this.handleGeneratePassword());

        // 인증 화면 비밀번호 토글 버튼들
        document.querySelectorAll('.toggle-password-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = document.getElementById(btn.dataset.target);
                input.type = input.type === 'password' ? 'text' : 'password';
            });
        });

        // 카테고리 관련
        this.elements.categoryFilter.addEventListener('click', (e) => {
            const chip = e.target.closest('.category-chip');
            if (!chip) return;
            this.selectedCategoryFilter = chip.dataset.category;
            this.elements.categoryFilter.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            this.renderPasswordList(this.elements.searchInput.value);
        });
        this.elements.categorySelect.addEventListener('change', (e) => {
            if (e.target.value === '__custom__') {
                this.elements.customCategoryInput.style.display = 'block';
                this.elements.customCategoryInput.focus();
            } else {
                this.elements.customCategoryInput.style.display = 'none';
            }
        });
        this.elements.customCategoryInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const name = e.target.value.trim();
                if (name) {
                    this.addCustomCategory(name);
                    e.target.value = '';
                    e.target.style.display = 'none';
                }
            }
        });

        // 설정 화면
        this.elements.settingsBackBtn.addEventListener('click', () => this.showScreen('main'));
        this.elements.autoLockTime.addEventListener('change', (e) => this.handleAutoLockTimeChange(e));
        this.elements.biometricToggle.addEventListener('change', (e) => this.handleBiometricToggle(e));
        this.elements.exportBtn.addEventListener('click', () => this.handleExport());
        this.elements.importBtn.addEventListener('click', () => this.elements.importFile.click());
        this.elements.importFile.addEventListener('change', (e) => this.handleImport(e));
        this.elements.changeMasterBtn.addEventListener('click', () => this.handleChangeMaster());
        this.elements.settingsLogoutBtn.addEventListener('click', () => this.handleLogout());

        // 카테고리 select 옵션 초기화
        this.refreshCategoryOptions();

        // 자동 잠금을 위한 활동 감지
        ['click', 'keypress', 'scroll', 'touchstart'].forEach(event => {
            document.addEventListener(event, () => this.resetAutoLock());
        });

        // 인증 만료 이벤트 수신
        window.addEventListener('auth:logout', () => {
            // checkAuth 진행 중이면 중복 처리 방지
            if (this._checkingAuth) return;

            if (Biometric.canAutoLogin()) {
                this.masterPassword = null;
                this.passwords = [];
                this.vaultMasterHash = null;
                this.clearAutoLock();
                this.showLockScreenForAutoLogin();
                setTimeout(() => this.handleBiometricAutoLogin(), 300);
            } else {
                this.showToast('세션이 만료되었습니다. 다시 로그인하세요.');
                this.handleLogout();
            }
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
            // 생체인증 등록 전까지만 일시 보관, checkAuth 후 즉시 제거
            this.loginEmail = email;
            this.loginPassword = password;
            this.elements.loginForm.reset();
            await this.checkAuth();
            // 생체인증 등록 완료 후 평문 자격증명 제거
            this.loginEmail = null;
            this.loginPassword = null;
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
            // 생체인증 등록 전까지만 일시 보관, checkAuth 후 즉시 제거
            this.loginEmail = email;
            this.loginPassword = password;
            this.elements.registerForm.reset();
            this.showToast('회원가입이 완료되었습니다');
            await this.checkAuth();
            // 생체인증 등록 완료 후 평문 자격증명 제거
            this.loginEmail = null;
            this.loginPassword = null;
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
        this.loginEmail = null;
        this.loginPassword = null;
        this.clearAutoLock();
        this.restoreLockScreenToNormal();
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

            // 생체인증 미등록 시 제안
            setTimeout(() => this.suggestBiometric(), 500);
        } catch (error) {
            console.error('잠금 해제 오류:', error);
            this.showToast('오류: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * 자동 로그인용 lock-screen 표시 (마스터 비밀번호 입력필드 숨김)
     */
    showLockScreenForAutoLogin() {
        this.elements.lockMessage.textContent = '지문으로 로그인하세요';
        this.elements.masterPassword.style.display = 'none';
        this.elements.unlockBtn.style.display = 'none';
        this.elements.biometricBtn.style.display = 'flex';
        this.elements.resetBtn.style.display = 'none';
        this.showScreen('lock');
    },

    /**
     * lock-screen을 일반 상태로 복원 (지문 취소/실패 시)
     */
    restoreLockScreenToNormal() {
        this.elements.masterPassword.style.display = '';
        this.elements.unlockBtn.style.display = '';
        this.elements.biometricBtn.style.display = Biometric.isEnabled() ? 'flex' : 'none';
        this.elements.resetBtn.style.display = '';
        this.elements.lockMessage.textContent = '마스터 비밀번호를 입력하세요';
    },

    /**
     * 생체인증 자동 로그인 (토큰 만료 시 지문으로 재로그인 + 잠금 해제)
     */
    async handleBiometricAutoLogin() {
        try {
            this.showLoading(true);

            // 1. 지문 인증 → 마스터 비밀번호 복호화
            const masterPw = await Biometric.authenticate();

            // 2. 로그인 자격증명 복호화
            const credentials = await Biometric.getLoginCredentials();
            if (!credentials) {
                throw new Error('저장된 로그인 정보가 없습니다.');
            }

            // 3. 서버 로그인 (새 JWT 발급)
            await API.login(credentials.email, credentials.password);

            // 4. Vault 가져와서 마스터 비밀번호 검증
            const vault = await API.getVault();
            this.vaultMasterHash = vault.masterHash;

            const isValid = await Crypto.verifyPassword(masterPw, this.vaultMasterHash);
            if (!isValid) {
                this.showToast('마스터 비밀번호가 변경되었습니다. 수동으로 입력하세요.');
                this.restoreLockScreenToNormal();
                return;
            }

            // 5. 성공: 메인 화면 진입
            this.masterPassword = masterPw;
            await this.loadPasswords();
            this.showScreen('main');
            this.renderPasswordList();
            this.resetAutoLock();
        } catch (error) {
            console.error('자동 로그인 오류:', error);

            // 로그인 실패 (401/403: 자격증명 오류) → 자격증명 삭제 후 로그인 화면
            if (error.status === 401 || error.status === 403) {
                localStorage.removeItem(Biometric.LOGIN_CREDENTIALS_KEY);
                API.removeToken();
                this.showToast('계정 정보가 변경되었습니다. 다시 로그인하세요.');
                this.showScreen('login');
                return;
            }

            // 지문 취소 → 토큰 있으면 lock-screen 복원, 없으면 로그인 화면
            if (error.message && error.message.includes('취소')) {
                if (API.isLoggedIn()) {
                    this.restoreLockScreenToNormal();
                } else {
                    this.showScreen('login');
                    this.showToast('지문 인증이 취소되었습니다. 로그인하세요.');
                }
                return;
            }

            // 기타 오류 (네트워크 등) → 토큰 있으면 lock-screen, 없으면 로그인 화면
            this.showToast(error.message || '자동 로그인 실패');
            if (API.isLoggedIn()) {
                this.restoreLockScreenToNormal();
            } else {
                this.showScreen('login');
            }
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

            // 로그인 자격증명 확인 (메모리에 없으면 모달로 입력 요청)
            const email = this.loginEmail;
            const password = this.loginPassword;

            if (!email || !password) {
                this.showCredentialModal(e.target);
                return;
            }

            await this.registerBiometric(email, password, e.target);
        } else {
            // 생체인증 비활성화
            Biometric.disable();
            this.showToast('지문 인증이 비활성화되었습니다');
        }
    },

    /**
     * 생체인증 등록 실행
     */
    async registerBiometric(email, password, toggleElement) {
        try {
            await Biometric.register(this.masterPassword, email, password);
            // 생체인증 등록 완료 → 평문 자격증명 즉시 제거
            this.loginEmail = null;
            this.loginPassword = null;
            this.showToast('지문 인증이 활성화되었습니다');
        } catch (error) {
            this.showToast(error.message);
            if (toggleElement) toggleElement.checked = false;
        }
    },

    /**
     * 자격증명 입력 모달 열기
     */
    showCredentialModal(toggleElement) {
        this._credentialToggle = toggleElement;
        this.elements.credentialEmail.value = '';
        this.elements.credentialPassword.value = '';
        this.elements.credentialModal.classList.add('show');
        this.elements.credentialEmail.focus();

        // 기존 리스너 제거 후 새로 등록 (중복 방지)
        const confirmBtn = this.elements.credentialConfirmBtn;
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        this.elements.credentialConfirmBtn = newBtn;

        newBtn.addEventListener('click', async () => {
            const email = this.elements.credentialEmail.value.trim();
            const password = this.elements.credentialPassword.value;

            if (!email || !password) {
                this.showToast('이메일과 비밀번호를 모두 입력하세요');
                return;
            }

            this.hideCredentialModal();
            await this.registerBiometric(email, password, this._credentialToggle);
        });
    },

    /**
     * 자격증명 입력 모달 닫기
     */
    hideCredentialModal() {
        this.elements.credentialModal.classList.remove('show');
        // 모달 닫기 시 토글 복원 (등록 안 된 경우)
        if (this._credentialToggle && !Biometric.isEnabled()) {
            this._credentialToggle.checked = false;
        }
    },

    /**
     * 생체인증 제안 (지원되지만 미등록 + 거절 안 한 경우)
     */
    async suggestBiometric() {
        const supported = await Biometric.isSupported();
        const enabled = Biometric.isEnabled();
        const dismissed = localStorage.getItem('biometric_suggest_dismissed') === 'true';

        if (supported && !enabled && !dismissed) {
            this.elements.biometricSuggestModal.classList.add('show');
        }
    },

    /**
     * 생체인증 제안 수락
     */
    async acceptBiometricSuggest() {
        this.elements.biometricSuggestModal.classList.remove('show');

        const email = this.loginEmail;
        const password = this.loginPassword;

        if (email && password) {
            await this.registerBiometric(email, password, this.elements.biometricToggle);
            this.elements.biometricToggle.checked = Biometric.isEnabled();
        } else {
            // 자격증명 없으면 모달로 입력 요청
            this.showCredentialModal(this.elements.biometricToggle);
        }
    },

    /**
     * 생체인증 제안 거절 ("다음에")
     */
    dismissBiometricSuggest() {
        this.elements.biometricSuggestModal.classList.remove('show');
        localStorage.setItem('biometric_suggest_dismissed', 'true');
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

        // 생체인증 버튼 표시 여부 + 자동 지문 인증
        if (Biometric.isEnabled()) {
            this.elements.biometricBtn.style.display = 'flex';
            setTimeout(() => this.handleBiometricUnlock(), 300);
        } else {
            this.elements.biometricBtn.style.display = 'none';
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
        let filtered = this.passwords;

        // 텍스트 검색 필터
        if (filter) {
            const q = filter.toLowerCase();
            filtered = filtered.filter(p =>
                p.siteName.toLowerCase().includes(q) ||
                (p.username && p.username.toLowerCase().includes(q))
            );
        }

        // 카테고리 필터
        if (this.selectedCategoryFilter && this.selectedCategoryFilter !== 'all') {
            filtered = filtered.filter(p => p.category === this.selectedCategoryFilter);
        }

        if (filtered.length === 0) {
            this.elements.passwordList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔑</div>
                    <p>${filter || this.selectedCategoryFilter !== 'all' ? '검색 결과가 없습니다' : '저장된 비밀번호가 없습니다'}</p>
                </div>
            `;
            return;
        }

        this.elements.passwordList.innerHTML = filtered.map(p => `
            <li class="password-item" data-id="${p.id}">
                <div class="password-item-icon">${p.siteName.charAt(0).toUpperCase()}</div>
                <div class="password-item-info">
                    <div class="password-item-name">${this.escapeHtml(p.siteName)}${p.category ? `<span class="password-item-category">${this.escapeHtml(p.category)}</span>` : ''}</div>
                    <div class="password-item-username">${this.escapeHtml(p.username || '(아이디 없음)')}</div>
                </div>
            </li>
        `).join('');

        // 클릭 이벤트 추가
        this.elements.passwordList.querySelectorAll('.password-item').forEach(item => {
            item.addEventListener('click', () => this.showDetailScreen(item.dataset.id));
        });
    },

    /**
     * 검색 처리
     */
    handleSearch(query) {
        this.renderPasswordList(query);
    },

    /**
     * 상세 보기 화면 표시
     */
    showDetailScreen(id) {
        const password = this.passwords.find(p => p.id === id);
        if (!password) return;

        this.currentEditId = id;
        this.currentDetailPassword = password.password; // 복사용 저장

        // 정보 표시
        this.elements.detailIcon.textContent = password.siteName.charAt(0).toUpperCase();
        this.elements.detailSiteName.textContent = password.siteName;
        this.elements.detailUsername.textContent = password.username || '(없음)';
        this.elements.detailPassword.textContent = '••••••••';
        this.elements.detailPassword.classList.add('password-hidden');
        this.detailPasswordVisible = false;

        // 카테고리 표시
        if (password.category) {
            this.elements.detailCategory.textContent = password.category;
            this.elements.detailCategory.style.display = 'inline-block';
        } else {
            this.elements.detailCategory.style.display = 'none';
        }

        // 메모 표시
        if (password.notes) {
            this.elements.detailNotes.textContent = password.notes;
            this.elements.detailNotesContainer.style.display = 'block';
        } else {
            this.elements.detailNotesContainer.style.display = 'none';
        }

        this.showScreen('detail');
    },

    /**
     * 상세 화면 비밀번호 표시/숨김 토글
     */
    toggleDetailPasswordVisibility() {
        const password = this.passwords.find(p => p.id === this.currentEditId);
        if (!password) return;

        this.detailPasswordVisible = !this.detailPasswordVisible;

        if (this.detailPasswordVisible) {
            this.elements.detailPassword.textContent = password.password;
            this.elements.detailPassword.classList.remove('password-hidden');
        } else {
            this.elements.detailPassword.textContent = '••••••••';
            this.elements.detailPassword.classList.add('password-hidden');
        }
    },

    /**
     * 클립보드에 복사
     */
    async copyToClipboard(type) {
        const password = this.passwords.find(p => p.id === this.currentEditId);
        if (!password) return;

        let text = '';
        let message = '';

        if (type === 'username') {
            text = password.username || '';
            message = '아이디가 복사되었습니다';
        } else if (type === 'password') {
            text = password.password;
            message = '비밀번호가 복사되었습니다';
        }

        try {
            await navigator.clipboard.writeText(text);
            this.showToast(message);
        } catch (error) {
            // 폴백: 구형 방식
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showToast(message);
        }
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
            // 카테고리 설정
            this.refreshCategoryOptions();
            const hasOption = Array.from(this.elements.categorySelect.options).some(o => o.value === password.category);
            this.elements.categorySelect.value = hasOption ? (password.category || '') : '';
            this.elements.customCategoryInput.style.display = 'none';
        } else {
            // 추가 모드
            this.elements.editTitle.textContent = '새 비밀번호';
            this.elements.deleteBtn.style.display = 'none';
            this.elements.passwordForm.reset();
            this.refreshCategoryOptions();
            this.elements.customCategoryInput.style.display = 'none';
        }

        this.elements.password.type = 'password';
        this.showScreen('edit');
    },

    /**
     * 저장 처리
     */
    async handleSave(e) {
        e.preventDefault();

        // 카테고리 값 결정
        let category = this.elements.categorySelect.value;
        if (category === '__custom__') {
            category = this.elements.customCategoryInput.value.trim();
            if (category) this.addCustomCategory(category);
        }

        const data = {
            id: this.currentEditId || Date.now().toString(),
            siteName: this.elements.siteName.value.trim(),
            username: this.elements.username.value.trim(),
            password: this.elements.password.value,
            notes: this.elements.notes.value.trim(),
            category: category || undefined,
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
     * 붙여넣기 모달 표시
     */
    showPasteModal() {
        this.elements.pasteInput.value = '';
        this.elements.pasteModal.classList.add('show');
        this.elements.pasteInput.focus();
    },

    /**
     * 붙여넣기 모달 닫기
     */
    hidePasteModal() {
        this.elements.pasteModal.classList.remove('show');
    },

    /**
     * 붙여넣기 텍스트 분석 후 편집 화면으로 이동
     */
    handlePasteAnalyze() {
        const text = this.elements.pasteInput.value.trim();
        if (!text) {
            this.showToast('텍스트를 붙여넣어주세요');
            return;
        }

        const parsed = PasteParser.parse(text);
        this.hidePasteModal();

        // 편집 화면을 새 항목 모드로 열기
        this.showEditScreen(null);

        // 파싱된 값으로 폼 채우기
        if (parsed.siteName) this.elements.siteName.value = parsed.siteName;
        if (parsed.username) this.elements.username.value = parsed.username;
        if (parsed.password) {
            this.elements.password.value = parsed.password;
            this.elements.password.type = 'text'; // 확인할 수 있게 표시
        }
        if (parsed.notes) this.elements.notes.value = parsed.notes;

        // 카테고리 설정
        if (parsed.category) {
            this.refreshCategoryOptions();
            const hasOption = Array.from(this.elements.categorySelect.options).some(o => o.value === parsed.category);
            if (hasOption) {
                this.elements.categorySelect.value = parsed.category;
            }
        }

        this.showToast('자동 분류 완료! 확인 후 저장하세요');
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
     * 사용자 추가 카테고리 목록 가져오기
     */
    getCustomCategories() {
        try {
            return JSON.parse(localStorage.getItem('custom_categories') || '[]');
        } catch {
            return [];
        }
    },

    /**
     * 카테고리 추가
     */
    addCustomCategory(name) {
        const customs = this.getCustomCategories();
        if (!customs.includes(name) && !this.DEFAULT_CATEGORIES.includes(name)) {
            customs.push(name);
            localStorage.setItem('custom_categories', JSON.stringify(customs));
            this.refreshCategoryOptions();
            this.refreshCategoryFilterChips();
        }
        this.elements.categorySelect.value = name;
    },

    /**
     * 카테고리 select 옵션 갱신
     */
    refreshCategoryOptions() {
        const select = this.elements.categorySelect;
        const current = select.value;
        // 기존 옵션 초기화
        select.innerHTML = '<option value="">선택 안함</option>';
        // 기본 카테고리
        this.DEFAULT_CATEGORIES.forEach(c => {
            select.innerHTML += `<option value="${c}">${c}</option>`;
        });
        // 사용자 카테고리
        this.getCustomCategories().forEach(c => {
            select.innerHTML += `<option value="${c}">${c}</option>`;
        });
        select.innerHTML += '<option value="__custom__">직접 입력...</option>';
        // 이전 값 복원
        if (current) select.value = current;
    },

    /**
     * 카테고리 필터 칩 갱신
     */
    refreshCategoryFilterChips() {
        const container = this.elements.categoryFilter;
        container.innerHTML = '<button class="category-chip active" data-category="all">전체</button>';
        const all = [...this.DEFAULT_CATEGORIES, ...this.getCustomCategories()];
        all.forEach(c => {
            container.innerHTML += `<button class="category-chip" data-category="${this.escapeHtml(c)}">${this.escapeHtml(c)}</button>`;
        });
        this.selectedCategoryFilter = 'all';
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
