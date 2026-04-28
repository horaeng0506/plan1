import type {Config} from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        line: 'var(--line)',
        muted: 'var(--muted)',
        txt: 'var(--txt)',
        ink: 'var(--ink)',
        success: 'var(--success)',
        info: 'var(--info)',
        warn: 'var(--warn)',
        danger: 'var(--danger)'
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Pretendard', 'monospace']
      }
    }
  },
  plugins: []
};

export default config;
