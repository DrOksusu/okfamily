/**
 * PasteParser - 붙여넣기 텍스트 파서 모듈
 *
 * 사용자가 붙여넣은 비정형 텍스트를 분석하여 비밀번호 정보를 추출한다.
 * 순수 로직 모듈로, 외부 라이브러리 의존성 없음.
 *
 * @example
 * const result = PasteParser.parse("신한은행\n아이디: mybank123\n비번: secret123");
 * // { siteName: "신한은행", username: "mybank123", password: "secret123", category: "은행", notes: "" }
 *
 * 테스트 케이스:
 *
 * 입력 예시 1:
 *   신한은행 인터넷뱅킹
 *   아이디: mybank123
 *   비번: s3cret!@#
 *   https://banking.shinhan.com
 *   OTP 카드번호 1234-5678
 * → { siteName: "banking.shinhan.com", username: "mybank123", password: "s3cret!@#",
 *     category: "은행", notes: "신한은행 인터넷뱅킹\nhttps://banking.shinhan.com\nOTP 카드번호 1234-5678" }
 *
 * 입력 예시 2:
 *   test@gmail.com
 *   mypassword123
 *   네이버
 * → { siteName: "네이버", username: "test@gmail.com", password: "mypassword123",
 *     category: "생활", notes: "" }
 */
const PasteParser = (() => {
  'use strict';

  // ── 카테고리 키워드 매핑 ──
  const CATEGORY_KEYWORDS = {
    은행: [
      '은행', '뱅킹', 'banking', 'bank',
      '국민', '신한', '우리', '하나', '농협', '기업',
      'sc', 'ibk', '카카오뱅크', '토스뱅크'
    ],
    증권: [
      '증권', '주식', 'stock',
      '키움', '미래에셋', '삼성증권', 'nh투자', '한국투자'
    ],
    암호화폐: [
      '암호화폐', '코인', '비트코인',
      '업비트', '빗썸', '바이낸스',
      'crypto', 'bitcoin', 'binance', 'coinbase'
    ],
    생활: [
      '네이버', '카카오', '구글',
      'google', 'naver', 'kakao',
      '쿠팡', '배민', '당근'
    ]
  };

  // ── 아이디 감지 키워드 ──
  const USERNAME_KEYWORDS = ['아이디', 'id', '계정', '이메일', 'email', '로그인'];

  // ── 비밀번호 감지 키워드 ──
  const PASSWORD_KEYWORDS = ['비밀번호', '비번', 'pw', 'password', 'pass', '패스워드'];

  // ── URL 패턴 ──
  // http://, https://, www. 로 시작하는 URL
  const URL_FULL_REGEX = /(?:https?:\/\/|www\.)[^\s]+/i;
  // .com, .co.kr, .net, .org 등으로 끝나는 단어 (도메인 형태)
  const URL_DOMAIN_REGEX = /\b[\w.-]+\.(?:com|co\.kr|net|org|io|kr|me|xyz|app|dev)\b/i;

  // ── 이메일 패턴 ──
  const EMAIL_REGEX = /[\w.+-]+@[\w.-]+\.\w{2,}/;

  /**
   * URL에서 도메인(호스트)을 추출한다.
   * @param {string} url - URL 문자열
   * @returns {string} 도메인 문자열
   */
  function extractDomain(url) {
    try {
      // www. 만 있고 프로토콜 없는 경우 처리
      let normalized = url;
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = 'https://' + normalized;
      }
      const urlObj = new URL(normalized);
      // www. 접두사 제거
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      // URL 파싱 실패 시 원본 그대로 반환
      return url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
    }
  }

  /**
   * 줄에서 키워드 뒤의 값을 추출한다.
   * @param {string} line - 텍스트 한 줄
   * @param {string[]} keywords - 매칭할 키워드 목록
   * @returns {string|null} 추출된 값 또는 null
   */
  function extractValueByKeyword(line, keywords) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    for (const keyword of keywords) {
      const keyLower = keyword.toLowerCase();
      const idx = lower.indexOf(keyLower);

      if (idx === -1) continue;

      // 키워드가 줄의 시작 부분에 있는지 확인 (앞에 알파벳/한글이 없어야 함)
      if (idx > 0) {
        const charBefore = trimmed[idx - 1];
        // 키워드 앞에 글자가 있으면 단독 키워드가 아님
        if (/[\w가-힣]/.test(charBefore)) continue;
      }

      // 키워드 뒤의 나머지 문자열 추출
      const afterKeyword = trimmed.substring(idx + keyword.length);

      // 구분자 제거 후 값 추출
      const match = afterKeyword.match(/^[\s:=\-]+(.+)/);
      if (match) {
        return match[1].trim();
      }

      // 구분자 없이 바로 값이 올 수는 없음 (키워드와 값이 붙어있는 경우 무시)
    }

    return null;
  }

  /**
   * 텍스트에서 카테고리를 감지한다.
   * @param {string} fullText - 전체 텍스트 (소문자 변환 전)
   * @returns {string} 감지된 카테고리 또는 빈 문자열
   */
  function detectCategory(fullText) {
    const lower = fullText.toLowerCase();

    // 우선순위 순서: 은행 → 증권 → 암호화폐 → 생활
    const categoryOrder = ['은행', '증권', '암호화폐', '생활'];

    for (const category of categoryOrder) {
      const keywords = CATEGORY_KEYWORDS[category];
      for (const keyword of keywords) {
        if (lower.includes(keyword.toLowerCase())) {
          return category;
        }
      }
    }

    return '';
  }

  /**
   * 줄이 아이디/비밀번호 키워드로 시작하는지 확인한다.
   * @param {string} line - 텍스트 한 줄
   * @returns {boolean}
   */
  function startsWithKnownKeyword(line) {
    const lower = line.trim().toLowerCase();
    const allKeywords = [...USERNAME_KEYWORDS, ...PASSWORD_KEYWORDS];
    return allKeywords.some(kw => lower.startsWith(kw.toLowerCase()));
  }

  /**
   * 줄이 이메일 형식인지 확인한다.
   * 이메일 줄은 URL로 처리하지 않기 위해 사용.
   * @param {string} line - 텍스트 한 줄
   * @returns {boolean}
   */
  function isEmailLine(line) {
    const trimmed = line.trim();
    return EMAIL_REGEX.test(trimmed) && !URL_FULL_REGEX.test(trimmed);
  }

  /**
   * 줄이 URL 패턴인지 확인한다.
   * 이메일 형식은 URL로 취급하지 않는다.
   * @param {string} line - 텍스트 한 줄
   * @returns {boolean}
   */
  function isUrlLine(line) {
    const trimmed = line.trim();
    // 이메일 형식이면 URL이 아님
    if (isEmailLine(trimmed)) return false;
    return URL_FULL_REGEX.test(trimmed) || URL_DOMAIN_REGEX.test(trimmed);
  }

  /**
   * 줄에서 URL을 추출한다.
   * 이메일 형식의 줄은 URL로 추출하지 않는다.
   * @param {string} line - 텍스트 한 줄
   * @returns {string|null} 추출된 URL 또는 null
   */
  function extractUrl(line) {
    const trimmed = line.trim();
    // 이메일 형식이면 URL로 추출하지 않음
    if (isEmailLine(trimmed)) return null;

    // 완전한 URL 먼저 시도
    const fullMatch = trimmed.match(URL_FULL_REGEX);
    if (fullMatch) return fullMatch[0];

    // 도메인 형태 시도
    const domainMatch = trimmed.match(URL_DOMAIN_REGEX);
    if (domainMatch) return domainMatch[0];

    return null;
  }

  /**
   * 메인 파싱 함수.
   * 붙여넣은 텍스트를 분석하여 비밀번호 정보를 추출한다.
   *
   * @param {string} text - 파싱할 텍스트
   * @returns {{ siteName: string, username: string, password: string, category: string, notes: string }}
   */
  function parse(text) {
    // 기본 결과 객체
    const result = {
      siteName: '',
      username: '',
      password: '',
      category: '',
      notes: ''
    };

    // 입력이 없으면 빈 결과 반환
    if (!text || typeof text !== 'string') {
      return result;
    }

    // 줄 단위 분리 및 빈 줄 제거
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return result;

    // ── 1단계: URL/사이트 감지 ──
    const urls = [];           // 발견된 URL 목록
    const urlLines = [];       // URL이 포함된 줄 인덱스
    let siteDomain = '';       // URL에서 추출한 도메인 (siteName 후보)

    lines.forEach((line, idx) => {
      const url = extractUrl(line);
      if (url) {
        urls.push(url);
        urlLines.push(idx);
        if (!siteDomain) {
          siteDomain = extractDomain(url);
        }
      }
    });

    // ── 2단계: 아이디 감지 ──
    const usernameLines = []; // 아이디가 감지된 줄 인덱스
    for (let i = 0; i < lines.length; i++) {
      const value = extractValueByKeyword(lines[i], USERNAME_KEYWORDS);
      if (value && !result.username) {
        result.username = value;
        usernameLines.push(i);
        break;
      }
    }

    // ── 3단계: 비밀번호 감지 ──
    const passwordLines = []; // 비밀번호가 감지된 줄 인덱스
    for (let i = 0; i < lines.length; i++) {
      const value = extractValueByKeyword(lines[i], PASSWORD_KEYWORDS);
      if (value && !result.password) {
        result.password = value;
        passwordLines.push(i);
        break;
      }
    }

    // ── 키워드 없이 이메일/비밀번호 추론 (폴백) ──
    // 아이디가 감지되지 않았을 때, 이메일 형식이 있으면 아이디로 사용
    if (!result.username) {
      for (let i = 0; i < lines.length; i++) {
        if (urlLines.includes(i) || passwordLines.includes(i)) continue;
        const emailMatch = lines[i].match(EMAIL_REGEX);
        if (emailMatch && lines[i].trim() === emailMatch[0]) {
          // 줄 전체가 이메일인 경우에만 아이디로 인식
          result.username = emailMatch[0];
          usernameLines.push(i);
          break;
        }
      }
    }

    // 비밀번호가 감지되지 않았고, 아이디 바로 다음 줄이 키워드 없는 단독 값이면 비밀번호로 추론
    if (!result.password && usernameLines.length > 0) {
      const nextIdx = usernameLines[0] + 1;
      if (nextIdx < lines.length) {
        const nextLine = lines[nextIdx];
        // URL도 아니고, 키워드로 시작하지도 않는 단독 값
        if (!isUrlLine(nextLine) && !startsWithKnownKeyword(nextLine)) {
          result.password = nextLine;
          passwordLines.push(nextIdx);
        }
      }
    }

    // ── 4단계: 카테고리 감지 ──
    result.category = detectCategory(text);

    // ── 5단계: 사이트명 감지 ──
    // 사용된 줄 인덱스 모음
    const usedLines = new Set([...urlLines, ...usernameLines, ...passwordLines]);

    if (siteDomain) {
      // URL이 있으면 도메인을 사이트명으로 사용
      result.siteName = siteDomain;
    } else {
      // URL이 없으면 첫 번째 줄이 키워드로 시작하지 않으면 사이트명
      if (lines.length > 0 && !startsWithKnownKeyword(lines[0])) {
        // 첫 줄이 아이디(이메일)나 비밀번호로 이미 사용되지 않았을 때
        if (!usedLines.has(0)) {
          result.siteName = lines[0];
          usedLines.add(0);
        }
      }

      // 그래도 사이트명이 없으면, 카테고리 키워드를 포함한 미사용 줄에서 추출
      if (!result.siteName) {
        for (let i = 0; i < lines.length; i++) {
          if (usedLines.has(i)) continue;
          const lower = lines[i].toLowerCase();
          const allCategoryKeywords = Object.values(CATEGORY_KEYWORDS).flat();
          if (allCategoryKeywords.some(kw => lower.includes(kw.toLowerCase()))) {
            result.siteName = lines[i];
            usedLines.add(i);
            break;
          }
        }
      }
    }

    // ── 6단계: 메모 (notes) 구성 ──
    // 아이디/비밀번호로 사용된 줄, URL 없을 때 사이트명으로 사용된 줄을 제외
    // URL 줄은 notes에 포함 (참조용)

    // notes에서 제외할 줄 인덱스 집합
    const excludeFromNotes = new Set([...usernameLines, ...passwordLines]);

    // URL이 없는 경우 사이트명으로 사용된 줄도 제외
    if (!siteDomain && result.siteName) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === result.siteName && usedLines.has(i)) {
          excludeFromNotes.add(i);
          break; // 첫 번째 매칭만 제외
        }
      }
    }

    const noteLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (excludeFromNotes.has(i)) continue;
      noteLines.push(lines[i]);
    }

    result.notes = noteLines.join('\n');

    return result;
  }

  // 공개 인터페이스
  return { parse };
})();
