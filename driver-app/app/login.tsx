import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../src/AuthContext';
import { useAppTheme, type ThemeColors } from '../constants/theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const colors = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const s = makeStyles(colors);

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.inner}>
        <View style={s.card}>
          <View style={s.logoBox}>
            <Text style={s.logoText}>S</Text>
          </View>
          <Text style={s.title}>ServiceOS</Text>
          <Text style={s.subtitle}>Driver Login</Text>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <TextInput
            style={s.input}
            placeholder="Email"
            placeholderTextColor={colors.textTertiary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoFocus
          />
          <TextInput
            style={s.input}
            placeholder="Password"
            placeholderTextColor={colors.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[s.button, loading && s.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 32,
      borderWidth: 1,
      borderColor: colors.border,
    },
    logoBox: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: colors.accent,
      alignSelf: 'center',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
    },
    logoText: { fontSize: 24, fontWeight: '800', color: '#fff' },
    title: { fontSize: 28, fontWeight: '700', color: colors.text, textAlign: 'center', letterSpacing: -0.5 },
    subtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 28,
    },
    error: {
      backgroundColor: colors.errorSoft,
      color: colors.error,
      padding: 12,
      borderRadius: 10,
      fontSize: 14,
      marginBottom: 16,
      textAlign: 'center',
      overflow: 'hidden',
    },
    input: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.text,
      marginBottom: 12,
    },
    button: {
      backgroundColor: colors.accent,
      borderRadius: 28,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 8,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
