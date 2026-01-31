import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  type User,
  type AuthState,
  getAuthState,
  setAuthState,
  clearAuth,
  validateCredentials,
  DEMO_USERS,
} from '@/lib/storage';

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<boolean>;
  loginAsUser: (user: User) => void;
  logout: () => void;
  users: User[];
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthStateLocal] = useState<AuthState>(() => getAuthState());

  useEffect(() => {
    setAuthState(authState);
  }, [authState]);

  const login = async (email: string, password: string): Promise<boolean> => {
    const user = validateCredentials(email, password);
    if (user) {
      const newState: AuthState = {
        isAuthenticated: true,
        user,
        token: `local_${Date.now()}`,
      };
      setAuthStateLocal(newState);
      return true;
    }
    return false;
  };

  const loginAsUser = (user: User) => {
    const newState: AuthState = {
      isAuthenticated: true,
      user,
      token: `local_${Date.now()}`,
    };
    setAuthStateLocal(newState);
  };

  const logout = () => {
    clearAuth();
    setAuthStateLocal({
      isAuthenticated: false,
      user: null,
      token: null,
    });
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        loginAsUser,
        logout,
        users: DEMO_USERS,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
