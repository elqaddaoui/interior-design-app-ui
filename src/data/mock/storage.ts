import AsyncStorage from '@react-native-async-storage/async-storage';
import { isForeignKey, storagePrefix } from '@/lib/tenant';

// Per tenant on the web (several tenants share one origin and one localStorage): the default tenant keeps the legacy `dwira:v1:` keys.
const prefix = () => storagePrefix();
export const storage = {
  async read<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await AsyncStorage.getItem(prefix() + key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  },
  async write(key: string, value: unknown) {
    try {
      await AsyncStorage.setItem(prefix() + key, JSON.stringify(value));
    } catch {
      /* quota / private mode: keep in-memory only */
    }
  },
  async clearAll() {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix()) && !isForeignKey(k));
    await AsyncStorage.multiRemove(keys);
  },
};
