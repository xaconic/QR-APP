const SUCCESS_COLOR = '#56C596';
const WARNING_COLOR = '#E9B85B';
const ERROR_COLOR = '#F07878';

export const COLORS = {
  primary: '#377FFD',
  primaryLight: '#71B2FC',
  primaryDark: '#183BBD',
  primaryButtonStart: '#2868F5',
  background: '#07142B',
  card: '#0D2040',
  textPrimary: '#F4F8FF',
  textSecondary: '#A7BBD6',
  textMuted: '#8298B5',
  textOnPrimary: '#FFFFFF',
  surface: '#102442',
  surfaceRaised: '#162D50',
  border: '#29466E',
  shadow: '#000000',
  backdrop: '#050A14CC',
  warning: WARNING_COLOR,
  success: SUCCESS_COLOR,
  error: ERROR_COLOR,
  danger: ERROR_COLOR,
  statusOpen: SUCCESS_COLOR,
  statusClosed: '#A7BBD6',
  statusPresent: SUCCESS_COLOR,
  statusLate: WARNING_COLOR,
  statusAbsent: ERROR_COLOR,
} as const;

export const SPACING = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const FONT_SIZES = {
  caption: 12,
  body: 14,
  bodyLarge: 16,
  title: 22,
  display: 28,
} as const;