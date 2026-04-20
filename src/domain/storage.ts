import { get, set, del } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

export const idbStorage: StateStorage = {
  getItem: async (name) => {
    const value = await get(name);
    return value ?? null;
  },
  setItem: async (name, value) => {
    await set(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};
