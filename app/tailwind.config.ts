import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1C1C1C',
        surface: '#F7F9FB',
        accentBlue: '#E3F5FF',
        accentLav: '#E5ECF6',
        accentMint: '#BAEDBD',
        chartBlue: '#A8C5DA',
        chartViolet: '#95A4FC',
        chartSky: '#B1E3FF',
      },
      borderRadius: {
        card: '16px',
      },
    },
  },
};

export default config;
