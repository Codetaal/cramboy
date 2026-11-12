/** Tailwind config for CramBoy. Rebuild docs/tw.css with `npm run build:css` after changing classes. */
module.exports = {
  content: ['./docs/index.html', './docs/emu.js', './docs/kr/ui.js'],
  darkMode: 'media',   // follows the iPhone's Light/Dark setting
  theme: {
    extend: {
      fontFamily: { sans: ['-apple-system', 'Apple SD Gothic Neo', 'system-ui', 'Noto Sans KR', 'sans-serif'] },
    },
  },
};
