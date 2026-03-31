import { useColorScheme } from 'react-native';

const dark = {
  background: '#000000',
  surface: '#212121',
  surfaceHover: '#2A2A2A',
  border: '#3A3A3A',
  borderSubtle: '#2E2E2E',
  text: '#FFFFFF',
  textSecondary: '#C0C0C0',
  textTertiary: '#8A8A8A',
  accent: '#22C55E',
  accentSoft: 'rgba(34,197,94,0.14)',
  error: '#F87171',
  errorSoft: 'rgba(248,113,113,0.14)',
  warning: '#FCD34D',
  warningSoft: 'rgba(252,211,77,0.12)',
};

const light = {
  background: '#FFFFFF',
  surface: '#EBEBEB',
  surfaceHover: '#E0E0E0',
  border: '#CCCCCC',
  borderSubtle: '#D6D6D6',
  text: '#0A0A0A',
  textSecondary: '#3D3D3D',
  textTertiary: '#666666',
  accent: '#16A34A',
  accentSoft: 'rgba(22,163,74,0.12)',
  error: '#DC2626',
  errorSoft: 'rgba(220,38,38,0.10)',
  warning: '#92400E',
  warningSoft: 'rgba(146,64,14,0.08)',
};

export type ThemeColors = typeof dark;

export const Colors = { dark, light } as const;

export function useAppTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'light' ? Colors.light : Colors.dark;
}
