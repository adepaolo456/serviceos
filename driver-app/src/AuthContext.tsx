import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { login as apiLogin, getProfile, clockIn, clockOut, updateLocation } from './api';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
  isClockedIn?: boolean;
  clockedInAt?: string | null;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isClockedIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  doClockIn: () => Promise<void>;
  doClockOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  isLoading: true,
  isClockedIn: false,
  login: async () => {},
  logout: async () => {},
  doClockIn: async () => {},
  doClockOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClockedIn, setIsClockedIn] = useState(false);
  const locationInterval = useRef<NodeJS.Timeout | null>(null);

  const startLocationTracking = () => {
    if (locationInterval.current) clearInterval(locationInterval.current);
    locationInterval.current = setInterval(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await updateLocation(loc.coords.latitude, loc.coords.longitude, 'On route');
      } catch { /* silent fail */ }
    }, 30000);
    // Also send immediately
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await updateLocation(loc.coords.latitude, loc.coords.longitude, 'On route');
      } catch { /* */ }
    })();
  };

  const doClockIn = async () => {
    await clockIn();
    setIsClockedIn(true);
    startLocationTracking();
  };

  const doClockOut = async () => {
    await clockOut();
    setIsClockedIn(false);
    if (locationInterval.current) {
      clearInterval(locationInterval.current);
      locationInterval.current = null;
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync('accessToken');
        if (token) {
          const profile = await getProfile();
          setUser(profile);
          if (profile.isClockedIn) {
            setIsClockedIn(true);
            startLocationTracking();
          }
        }
      } catch {
        /* invalid token */
      } finally {
        setIsLoading(false);
      }
    })();
    return () => {
      if (locationInterval.current) clearInterval(locationInterval.current);
    };
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    setUser(data.user);
    if (data.user?.isClockedIn) {
      setIsClockedIn(true);
      startLocationTracking();
    }
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('accessToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isClockedIn, login, logout, doClockIn, doClockOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
