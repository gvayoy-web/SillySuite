(() => {
  'use strict';

  // デザインシステム統合ユーティリティ
  // すべてのCSSファイルで統一されたデザイン・トークンを使用するために必要なヘルパー

  const StyleInjector = {
    // すべてのスクラッチCSSファイルでデザイン・トークンを注入
    injectUnifiedDesignTokens() {
      const designTokens = document.createElement('link');
      designTokens.rel = 'stylesheet';
      designTokens.type = 'text/css';
      designTokens.href = '../css/design-tokens.css';
      document.head.appendChild(designTokens);
    },

    // 互換可能なデザインシステムを確認
    validateDesignSystem() {
      const requiredTokens = [
        '--sq-color-bg-primary',
        '--sq-color-fg-primary',
        '--sq-color-accent-primary',
        '--sq-space-md',
        '--sq-radius-md',
        '--sq-shadow-md',
        '--sq-font-size-base'
      ];

      const missing = [];
      requiredTokens.forEach(token => {
        if (!getComputedStyle(document.documentElement).getPropertyValue(token)) {
          missing.push(token);
        }
      });

      if (missing.length > 0) {
        console.warn('Design system validation warnings:', missing);
        return false;
      }

      return true;
    },

    // 特定の要素にデザイン・システムを適用
    applyThemeVars(element, vars) {
      Object.keys(vars).forEach(key => {
        element.style.setProperty(`--${key}`, vars[key]);
      });
    },

    // テーマの同期
    syncThemeWithBody(htmlElement) {
      const body = document.body;
      const html = htmlElement || document.documentElement;

      // 共通のクラスを転送
      body.classList.forEach(className => {
        if (className.startsWith('theme-') || className === 'light' || className === 'dark') {
          html.classList.add(className);
        }
      });

      // CSS変数を同期
      const computedStyle = getComputedStyle(html);
      const cssVars = {};

      for (let i = 0; i < computedStyle.length; i++) {
        const name = computedStyle.item(i);
        if (name.startsWith('--sq-')) {
          cssVars[name.replace('--sq-', '')] = computedStyle.getPropertyValue(name);
        }
      }

      return cssVars;
    },

    // テーマ固有のCSS変数を生成
    generateThemeVariables(baseVars, themeType) {
      const themes = {
        dark: {
          '--bg-primary': '#0B0B0B',
          '--bg-secondary': '#121212',
          '--fg-primary': '#F2EBDD',
          '--accent-primary': '#FF5E3A'
        },
        light: {
          '--bg-primary': '#F8FAFC',
          '--bg-secondary': '#F1F5F9',
          '--fg-primary': '#0F172A',
          '--accent-primary': '#0D6EFD'
        },
        fire: {
          '--bg-primary': '#1A0000',
          '--bg-secondary': '#2D0000',
          '--fg-primary': '#FFCC99',
          '--accent-primary': '#FF4400'
        },
        ocean: {
          '--bg-primary': '#001122',
          '--bg-secondary': '#002244',
          '--fg-primary': '#66CCFF',
          '--accent-primary': '#00AAFF'
        }
      };

      const themeVars = themes[themeType] || themes.dark;
      return { ...baseVars, ...themeVars };
    },

    // レスポンスィブデザイントークンを確認
    checkResponsiveTokens() {
      const breakpoints = {
        xs: 320,
        sm: 480,
        md: 768,
        lg: 1024,
        xl: 1280,
        '2xl': 1536
      };

      const style = document.createElement('style');
      style.textContent = `
        /* レスポンスィブデザイントークン */
        :root {
          --sq-breakpoint-xs: ${breakpoints.xs}px;
          --sq-breakpoint-sm: ${breakpoints.sm}px;
          --sq-breakpoint-md: ${breakpoints.md}px;
          --sq-breakpoint-lg: ${breakpoints.lg}px;
          --sq-breakpoint-xl: ${breakpoints.xl}px;
          --sq-breakpoint-2xl: ${breakpoints['2xl']}px;
        }

        /* 流体 typographyを使用 */
        @media (max-width: 768px) {
          :root {
            --sq-font-size-4xl: calc(var(--sq-font-size-4xl) * 0.7);
            --sq-font-size-3xl: calc(var(--sq-font-size-3xl) * 0.75);
            --sq-font-size-2xl: calc(var(--sq-font-size-2xl) * 0.8);
            --sq-display-timer-size: calc(var(--sq-display-timer-size) * 0.6);
            --sq-question-text-size: calc(var(--sq-question-text-size) * 0.8);
          }
        }
      `;

      document.head.appendChild(style);
    },

    // CSSからデザイントークンを抽出（デバッグ用）
    extractCSSTokens(cssText) {
      const regex = /--sq-[^:]+:\s*[^;]+;/g;
      const matches = cssText.match(regex) || [];

      return matches.map(match => {
        const [key, value] = match.split(':').map(s => s.trim());
        return { key: key.replace('--sq-', ''), value: value.replace(/;/g, '') };
      });
    }
  };

  // グローバルにエクスポート
  window.DesignSystem = StyleInjector;

  // 初期化時に自動実行
  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.scratch-app, .sq-builder')) {
      StyleInjector.injectUnifiedDesignTokens();
      StyleInjector.validateDesignSystem();
      StyleInjector.checkResponsiveTokens();
    }
  });

})();
