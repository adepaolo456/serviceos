import { useColorScheme } from 'react-native';

const dark = {
  background: '#000000',
  surface: '#0A0A0A',
  surfaceHover: '#1A1A1A',
  border: '#1F1F1F',
  text: '#FFFFFF',
  textSecondary: '#888888',
  textTertiary: '#555555',
  accent: '#22C55E',
  accentSoft: 'rgba(34,197,94,0.08)',
  error: '#EF4444',
  errorSoft: 'rgba(239,68,68,0.08)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245,158,11,0.08)',
};

const light = {
  background: '#FFFFFF',
  surface: '#FAFAFA',
  surfaceHover: '#F0F0F0',
  border: '#E5E5E5',
  text: '#0A0A0A',
  textSecondary: '#6B6B6B',
  textTertiary: '#999999',
  accent: '#16A34A',
  accentSoft: 'rgba(22,163,74,0.08)',
  error: '#EF4444',
  errorSoft: 'rgba(239,68,68,0.06)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245,158,11,0.06)',
};

export type ThemeColors = typeof dark;

export const Colors = { dark, light } as const;

export function useAppTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'light' ? Colors.light : Colors.dark;
}
