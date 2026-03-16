// services/authService.ts
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { Platform } from 'react-native';

// Safe storage — AsyncStorage on mobile, localStorage on web
const Storage = {
  async get(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return localStorage.getItem(key);
      }
      const lib = await import('@react-native-async-storage/async-storage');
      return lib.default.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(key, value);
        return;
      }
      const lib = await import('@react-native-async-storage/async-storage');
      await lib.default.setItem(key, value);
    } catch {}
  },
  async remove(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        localStorage.removeItem(key);
        return;
      }
      const lib = await import('@react-native-async-storage/async-storage');
      await lib.default.removeItem(key);
    } catch {}
  },
};

export interface ManagerProfile {
  uid: string;
  name: string;
  employeeId: string;
  role: 'manager' | 'admin';
  zones: string[];
  phone: string;
  designation: string;
}

export const loginManager = async (email: string, password: string): Promise<ManagerProfile> => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  const docSnap = await getDoc(doc(db, 'users', user.uid));

  if (!docSnap.exists()) {
    await signOut(auth);
    throw new Error('User profile not found. Contact administrator.');
  }

  const data = docSnap.data();

  if (data.role !== 'manager' && data.role !== 'admin') {
    await signOut(auth);
    throw new Error('Access denied. Only managers can login.');
  }

  const profile: ManagerProfile = {
    uid: user.uid,
    name: data.name || 'Manager',
    employeeId: data.employeeId || '',
    role: data.role,
    zones: data.zones || [],
    phone: data.phone || '',
    designation: data.designation || 'Sanitation Manager',
  };

  // Save credentials for biometric login (mobile only)
  await Storage.set('manager_email', email);
  await Storage.set('manager_password', password);

  return profile;
};

export const logoutManager = async () => {
  await signOut(auth);
  await Storage.remove('manager_email');
  await Storage.remove('manager_password');
};

export const biometricLogin = async (): Promise<ManagerProfile | null> => {
  if (Platform.OS === 'web') return null;

  try {
    const LocalAuth = await import('expo-local-authentication');
    const hasHardware = await LocalAuth.hasHardwareAsync();
    const isEnrolled = await LocalAuth.isEnrolledAsync();
    if (!hasHardware || !isEnrolled) return null;

    const result = await LocalAuth.authenticateAsync({
      promptMessage: 'Verify your identity',
      fallbackLabel: 'Use Password',
    });

    if (!result.success) return null;

    const email = await Storage.get('manager_email');
    const password = await Storage.get('manager_password');
    if (!email || !password) return null;

    return loginManager(email, password);
  } catch {
    return null;
  }
};

export const checkBiometricAvailable = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return false;
  try {
    const LocalAuth = await import('expo-local-authentication');
    const hasHardware = await LocalAuth.hasHardwareAsync();
    const isEnrolled = await LocalAuth.isEnrolledAsync();
    const storedEmail = await Storage.get('manager_email');
    return hasHardware && isEnrolled && !!storedEmail;
  } catch {
    return false;
  }
};

// Restore session on app reload — call this from dashboard layout
export const restoreSession = (): Promise<ManagerProfile | null> => {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (!user) {
        resolve(null);
        return;
      }
      try {
        const docSnap = await getDoc(doc(db, 'users', user.uid));
        if (!docSnap.exists()) {
          resolve(null);
          return;
        }
        const data = docSnap.data();
        resolve({
          uid: user.uid,
          name: data.name || 'Manager',
          employeeId: data.employeeId || '',
          role: data.role,
          zones: data.zones || [],
          phone: data.phone || '',
          designation: data.designation || 'Sanitation Manager',
        });
      } catch {
        resolve(null);
      }
    });
  });
};