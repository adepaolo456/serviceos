import { useColorScheme } from 'react-native';

const dark = {
  background: '#000000',
  surface: '#FFFFFF',
  surfaceHover: '#F5F5F5',
  border: '#E5E5E5',
  borderSubtle: '#F0F0F0',
  text: '#0A0A0A',
  textSecondary: '#5C5C5C',
  textTertiary: '#8A8A8A',
  accent: '#22C55E',
  accentSoft: 'rgba(34,197,94,0.08)',
  error: '#DC2626',
  errorSoft: 'rgba(220,38,38,0.06)',
  warning: '#D97706',
  warningSoft: 'rgba(217,119,6,0.06)',
  frameBg: '#000000',
  frameText: '#FFFFFF',
  frameTextMuted: '#B0B0B0',
  frameBorder: '#1E1E1E',
};

const light = {
  background: '#FFFFFF',
  surface: '#F5F5F5',
  surfaceHover: '#EEEEEE',
  border: '#E0E0E0',
  borderSubtle: '#EBEBEB',
  text: '#0A0A0A',
  textSecondary: '#5C5C5C',
  textTertiary: '#8A8A8A',
  accent: '#16A34A',
  accentSoft: 'rgba(22,163,74,0.12)',
  error: '#DC2626',
  errorSoft: 'rgba(220,38,38,0.10)',
  warning: '#92400E',
  warningSoft: 'rgba(146,64,14,0.08)',
  frameBg: '#FAFAFA',
  frameText: '#0A0A0A',
  frameTextMuted: '#666666',
  frameBorder: '#E0E0E0',
};

export type ThemeColors = typeof dark;

export const Colors = { dark, light } as const;

export function useAppTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'light' ? Colors.light : Colors.dark;
}
