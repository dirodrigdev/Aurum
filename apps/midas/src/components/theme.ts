export const T = {
  bg: '#0E1116',
  surface: '#151922',
  surfaceEl: '#1B2130',
  border: '#262C3D',
  textPrimary: '#E8ECF3',
  textSecondary: '#A3ACBB',
  textMuted: '#6F788A',
  primary: '#5B8CFF',
  primaryStrong: '#3E6AE1',
  secondary: '#8DA2FB',
  metalBase: '#8A94A6',
  metalHi: '#B6C0D4',
  metalDeep: '#5F687A',
  positive: '#3FBF7F',
  warning: '#D4A65A',
  negative: '#D45A5A',
  fan1: '#1B2D55',
  fan2: '#1E3A6E',
  fan3: '#243F82',
};

export const css = {
  app: {
    background: T.bg,
    minHeight: '100vh',
    color: T.textPrimary,
    fontFamily: '"SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
    WebkitFontSmoothing: 'antialiased' as const,
  },
  mono: { fontFamily: '"SF Mono", "Fira Code", monospace' },
};
